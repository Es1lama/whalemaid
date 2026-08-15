// SPEC: docs/security-audit.md#SEC-001/002/003 控制面 API：安装码注册、每设备凭据、/connect 密码匹配+限速（隧道 token 注册后固定，授权在受控端网关侧）
// SPEC: docs/threat-model.md#TM-005 心跳/在线状态/吊销
use crate::config::RelayConfig;
use crate::grants::GrantStore;
use crate::limiter::{Attempt, Limiter};
use crate::rathole::{render_server_config, RatholeSidecar};
use crate::registry::Registry;
use axum::{
    extract::connect_info::ConnectInfo,
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    response::IntoResponse,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::Response,
    routing::{delete, get, post},
    Json, Router,
};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

pub const HEARTBEAT_TIMEOUT_SECS: u64 = 45;

pub struct AppState {
    pub registry: Mutex<Registry>,
    pub config: RelayConfig,
    pub sidecar: Mutex<RatholeSidecar>,
    /// 管理员令牌（列表/管理操作）
    pub admin_token: String,
    /// 一次性安装码（受控端首次注册；SEC-001）
    pub install_code: String,
    /// /connect 限速与锁定（SEC-002）
    pub limiter: Mutex<Limiter>,
    /// 仅在显式配置可信反代时解析 X-Forwarded-For（审计三轮#2：默认用 socket peer IP）
    pub trusted_proxy: bool,
    /// rathole noise 静态密钥对（SEC-001/003）：private 只进配置文件；public 经 /tunnel 下发受控端 pin
    pub noise_private_key: String,
    pub noise_public_key: String,
    /// 主控端一次性连接 grant（SEC-004b）
    pub grants: Mutex<GrantStore>,
}

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/_whalemaid/devices", post(register).get(list))
        .route("/_whalemaid/devices/:id", delete(revoke))
        .route("/_whalemaid/devices/:id/heartbeat", post(heartbeat))
        .route("/_whalemaid/devices/:id/status", get(device_status))
        .route("/_whalemaid/devices/:id/tunnel", post(tunnel))
        .route("/_whalemaid/devices/:id/password", post(update_password))
        .route("/_whalemaid/connect", post(connect))
        .route("/_whalemaid/tunnel-ws", get(tunnel_ws))
        .with_state(state)
}

async fn health() -> Json<Value> {
    Json(json!({ "ok": true }))
}

fn bearer(headers: &HeaderMap) -> Option<&str> {
    headers.get("authorization")?.to_str().ok().map(|v| v.strip_prefix("Bearer ").unwrap_or(v))
}

/// 限速键信源（审计三轮#2）：默认 socket peer IP；只有 WHALEMAID_RELAY_TRUSTED_PROXY=1 时信任反代注入的 X-Forwarded-For
fn client_ip(state: &AppState, headers: &HeaderMap, peer: Option<std::net::SocketAddr>) -> String {
    if state.trusted_proxy {
        if let Some(v) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
            // 可信链末端 = 第一个（最靠近客户端的）地址
            return v.split(',').next().unwrap_or("unknown").trim().to_string()
        }
    }
    peer.map(|p| p.ip().to_string()).unwrap_or_else(|| "unknown".to_string())
}

fn unauthorized() -> (StatusCode, Json<Value>) {
    (StatusCode::UNAUTHORIZED, Json(json!({ "error": "unauthorized" })))
}

async fn reload_config(s: &Arc<AppState>) -> Result<(), String> {
    let reg = s.registry.lock().await;
    let cfg = render_server_config(&reg, &s.config.rathole_bind, &s.noise_private_key);
    s.sidecar
        .lock()
        .await
        .reload(&s.config.rathole_server_cfg, &cfg)
        .map_err(|e| e.to_string())
}

/// SEC-001：受控端首次注册——需一次性安装码；签发每设备凭据与初始隧道 token
async fn register(State(s): State<Arc<AppState>>, ConnectInfo(peer): ConnectInfo<std::net::SocketAddr>, headers: HeaderMap, body: String) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    if s.install_code.is_empty() || headers.get("x-install-code").and_then(|v| v.to_str().ok()) != Some(s.install_code.as_str()) {
        return Err(unauthorized())
    }
    // 审计三轮#4：enrollment secret 为长期共享秘密——按 IP 限速防批量注册
    if s.limiter.lock().await.check(&format!("register:{}", client_ip(&s, &headers, Some(peer)))) != Attempt::Allowed {
        return Err((StatusCode::TOO_MANY_REQUESTS, Json(json!({ "error": "rate-limited" }))))
    }
    let b: serde_json::Value = serde_json::from_str(&body).map_err(|_| (StatusCode::BAD_REQUEST, Json(json!({ "error": "bad body" }))))?;
    let device_id = b.get("deviceId").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let password_digest = b.get("passwordDigest").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if device_id.is_empty() || password_digest.is_empty() {
        return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": "deviceId/passwordDigest required" }))))
    }
    let (record, credential, tunnel_token) = s
        .registry
        .lock()
        .await
        .register(&device_id, &password_digest)
        .map_err(|e| (StatusCode::CONFLICT, Json(json!({ "error": e.to_string() }))))?;
    reload_config(&s).await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e }))))?;
    Ok((StatusCode::OK, Json(json!({
        "id": record.id, "service": record.service, "port": record.port,
        "tunnelToken": tunnel_token, "credential": credential,
    }))))
}

/// SEC-002：主控端连接——设备编号+密码；限速/锁定。
/// SEC-003（Codex 审计修复）：只做密码验证与寻址，**不轮换隧道 token**（token 是受控端侧固定凭据）；
/// SEC-004b：成功后签发**短时一次性 grant**（2min、单次消费），主控端凭 grant 走 TLS 隧道入口进入 rathole 隧道；
/// 响应**不含设备服务端口**（路由秘密不外泄），只给隧道入口端口（与 API 同主机）。
async fn connect(State(s): State<Arc<AppState>>, ConnectInfo(peer): ConnectInfo<std::net::SocketAddr>, headers: HeaderMap, body: String) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let b: serde_json::Value = serde_json::from_str(&body).map_err(|_| (StatusCode::BAD_REQUEST, Json(json!({ "error": "bad body" }))))?;
    let device_id = b.get("deviceId").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let password = b.get("password").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if device_id.is_empty() || password.is_empty() {
        return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": "deviceId/password required" }))))
    }
    let ip = client_ip(&s, &headers, Some(peer));
    let key = format!("{ip}:{device_id}");
    match s.limiter.lock().await.check(&key) {
        Attempt::RateLimited => return Err((StatusCode::TOO_MANY_REQUESTS, Json(json!({ "error": "rate-limited" })))),
        Attempt::Locked => return Err((StatusCode::LOCKED, Json(json!({ "error": "locked" })))),
        Attempt::Allowed => {}
    }
    let (service, port) = {
        let reg = s.registry.lock().await;
        let Some(dev) = reg.verify_device_password(&device_id, &password) else {
            drop(reg);
            s.limiter.lock().await.record_fail(&key);
            return Err((StatusCode::UNAUTHORIZED, Json(json!({ "error": "wrong password or unknown device" }))))
        };
        (dev.service.clone(), dev.port)
    };
    s.limiter.lock().await.record_success(&key);
    // SEC-004b：一次性 grant（TTL 2min）；隧道入口端口从配置解析
    let grant = Uuid::new_v4().simple().to_string();
    s.grants.lock().await.issue(grant.clone(), device_id.clone(), port);
    let tunnel_port = s.config.tunnel_listen.rsplit(':').next().and_then(|p| p.parse::<u16>().ok()).unwrap_or(9443);
    Ok((StatusCode::OK, Json(json!({ "deviceId": device_id, "service": service, "grant": grant, "grantTtlSec": 120, "tunnelPort": tunnel_port }))))
}

/// 密码轮换（审计三轮#3）：每设备凭据鉴权，原子替换 PHC 并吊销该设备在途 grant——旧密码立即失效
async fn update_password(State(s): State<Arc<AppState>>, headers: HeaderMap, axum::extract::Path(id): axum::extract::Path<String>, body: String) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let Some(cred) = bearer(&headers) else { return Err(unauthorized()) };
    let authorized = { s.registry.lock().await.authenticate_credential(cred).map(|d| d.id == id).unwrap_or(false) };
    if !authorized {
        return Err(unauthorized())
    }
    let b: serde_json::Value = serde_json::from_str(&body).map_err(|_| (StatusCode::BAD_REQUEST, Json(json!({ "error": "bad body" }))))?;
    let digest = b.get("passwordDigest").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if digest.is_empty() {
        return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": "passwordDigest required" }))))
    }
    let updated = { s.registry.lock().await.update_password(&id, &digest) };
    if !updated {
        return Ok((StatusCode::NOT_FOUND, Json(json!({ "error": "unknown-device" }))))
    }
    s.grants.lock().await.clear_device(&id);
    Ok((StatusCode::OK, Json(json!({ "ok": true }))))
}

/// 被控端隧道签发：凭据鉴权，返回当前隧道 token（不轮换——token 一经注册固定，SEC-003）
async fn tunnel(State(s): State<Arc<AppState>>, headers: HeaderMap, axum::extract::Path(id): axum::extract::Path<String>) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let Some(cred) = bearer(&headers) else { return Err(unauthorized()) };
    let authorized = { s.registry.lock().await.authenticate_credential(cred).map(|d| d.id == id).unwrap_or(false) };
    if !authorized {
        return Err(unauthorized())
    }
    let (service, port, token) = {
        let reg = s.registry.lock().await;
        let dev = reg.active().find(|d| d.id == id).ok_or((StatusCode::NOT_FOUND, Json(json!({ "error": "unknown-device" }))))?;
        (dev.service.clone(), dev.port, dev.rathole_token.clone())
    };
    // SEC-001/003：受控端 rathole 客户端必须 pin 服务端 noise 公钥（NK 模式，防中间人）
    Ok((StatusCode::OK, Json(json!({ "id": id, "service": service, "port": port, "tunnelToken": token, "serverPublicKey": s.noise_public_key }))))
}

async fn list(State(s): State<Arc<AppState>>, headers: HeaderMap) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    if s.admin_token.is_empty() || bearer(&headers) != Some(s.admin_token.as_str()) {
        return Err(unauthorized())
    }
    let reg = s.registry.lock().await;
    let devices: Vec<Value> = reg
        .active()
        .map(|d| {
            let online = reg.online(d.id.as_str(), HEARTBEAT_TIMEOUT_SECS);
            json!({ "id": d.id, "port": d.port, "revoked": d.revoked, "online": online })
        })
        .collect();
    Ok((StatusCode::OK, Json(json!({ "devices": devices }))))
}

async fn heartbeat(State(s): State<Arc<AppState>>, headers: HeaderMap, axum::extract::Path(id): axum::extract::Path<String>) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {    let Some(cred) = bearer(&headers) else { return Err(unauthorized()) };
    let authorized = { s.registry.lock().await.authenticate_credential(cred).map(|d| d.id == id).unwrap_or(false) };
    if !authorized {
        return Err(unauthorized())
    }
    let known = s.registry.lock().await.touch(&id);
    if !known {
        return Ok((StatusCode::NOT_FOUND, Json(json!({ "error": "unknown-device" }))))
    }
    Ok((StatusCode::OK, Json(json!({ "ok": true }))))
}

/// audit#4（D-026）：主控端按设备编号查询状态——Phase A 无账号，设备列表 = 主控端本机记忆 + 本端点逐个查询；
/// 不回 IP/端口/token（DESIGN §6.3 不泄露约束）；按 IP 限速防编号枚举；未知与离线区分（registered 位）
async fn device_status(State(s): State<Arc<AppState>>, ConnectInfo(peer): ConnectInfo<std::net::SocketAddr>, headers: HeaderMap, axum::extract::Path(id): axum::extract::Path<String>) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let ip = client_ip(&s, &headers, Some(peer));
    if s.limiter.lock().await.check(&format!("status:{ip}")) != Attempt::Allowed {
        return Err((StatusCode::TOO_MANY_REQUESTS, Json(json!({ "error": "rate-limited" }))))
    }
    let (registered, online, last_seen_at) = {
        let reg = s.registry.lock().await;
        let found_id = reg.active().find(|d| d.id == id).map(|d| d.id.clone());
        match found_id {
            Some(did) => (true, reg.online(&did, HEARTBEAT_TIMEOUT_SECS), reg.last_seen_at(&did)),
            None => (false, false, None),
        }
    };
    Ok((StatusCode::OK, Json(json!({ "id": id, "registered": registered, "online": online, "last_seen_at": last_seen_at }))))
}

async fn revoke(State(s): State<Arc<AppState>>, headers: HeaderMap, axum::extract::Path(id): axum::extract::Path<String>) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    // 设备凭据（自吊销）或管理员令牌均可
    let authorized = {
        let reg = s.registry.lock().await;
        bearer(&headers)
            .map(|cred| reg.authenticate_credential(cred).map(|d| d.id == id).unwrap_or(false))
            .unwrap_or(false)
            || (!s.admin_token.is_empty() && bearer(&headers) == Some(s.admin_token.as_str()))
    };
    if !authorized {
        return Err(unauthorized())
    }
    let found = s.registry.lock().await.revoke(&id);
    reload_config(&s).await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e }))))?;
    Ok((StatusCode::OK, Json(json!({ "revoked": found }))))
}

/// SEC-004b Web 变体（主控端 Web/Electron/Capacitor 统一入口，audit#6）：
/// 浏览器无法开裸 TLS 隧道，故经 WSS 承载同一条 grant 管道——首个文本帧 `GRANT <token> <deviceId>`，
/// 之后帧 = 原始字节（HTTP 请求等），双工转发到受控端 rathole 服务端口。限速 + 单次消费 + 设备绑定同裸 TLS 入口。
async fn tunnel_ws(State(s): State<Arc<AppState>>, ConnectInfo(peer): ConnectInfo<std::net::SocketAddr>, headers: HeaderMap, ws: WebSocketUpgrade) -> Response {
    let ip = client_ip(&s, &headers, Some(peer));
    if s.limiter.lock().await.check(&format!("tunnelws:{ip}")) != Attempt::Allowed {
        return (StatusCode::TOO_MANY_REQUESTS, Json(json!({ "error": "rate-limited" }))).into_response()
    }
    ws.on_upgrade(move |socket| ws_tunnel_session(s, socket))
}

async fn ws_tunnel_session(state: Arc<AppState>, mut socket: WebSocket) {

    // 首帧 = GRANT 行（10s 超时）
    let grant_line = match tokio::time::timeout(std::time::Duration::from_secs(10), socket.recv()).await {
        Ok(Some(Ok(Message::Text(t)))) => t,
        _ => return,
    };
    let parts: Vec<&str> = grant_line.split_whitespace().collect();
    if parts.len() != 3 || parts[0] != "GRANT" {
        return;
    }
    let Some(port) = state.grants.lock().await.consume(parts[1], parts[2]) else {
        return;
    };
    let Ok(mut backend) = tokio::net::TcpStream::connect(("127.0.0.1", port)).await else {
        return;
    };

    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    // 单任务 select 双工泵（避免半连接别名借用）：ws 帧 ↔ tcp 字节
    let mut buf = [0u8; 16 * 1024];
    loop {
        tokio::select! {
            msg = socket.recv() => {
                let r = match msg {
                    Some(Ok(Message::Binary(d))) => backend.write_all(&d).await,
                    Some(Ok(Message::Text(d))) => backend.write_all(d.as_bytes()).await,
                    Some(Ok(Message::Ping(_))) => { let _ = socket.send(Message::Pong(vec![])).await; continue }
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => break,
                };
                if r.is_err() { break }
            }
            n = backend.read(&mut buf) => {
                match n {
                    Ok(0) => break,
                    Ok(n) => { if socket.send(Message::Binary(buf[..n].to_vec())).await.is_err() { break } }
                    Err(_) => break,
                }
            }
        }
    }
    let _ = socket.close().await;
}
