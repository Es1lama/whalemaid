// SPEC: docs/security-audit.md#SEC-001/002/003 控制面 API：安装码注册、每设备凭据、/connect 密码匹配+限速（隧道 token 注册后固定，授权在受控端网关侧）
// SPEC: docs/threat-model.md#TM-005 心跳/在线状态/吊销
use crate::config::RelayConfig;
use crate::limiter::{Attempt, Limiter};
use crate::rathole::{render_server_config, RatholeSidecar};
use crate::registry::Registry;
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::{delete, get, post},
    Json, Router,
};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::sync::Mutex;

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
    /// rathole noise 静态密钥对（SEC-001/003）：private 只进配置文件；public 经 /tunnel 下发受控端 pin
    pub noise_private_key: String,
    pub noise_public_key: String,
}

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/_whalemaid/devices", post(register).get(list))
        .route("/_whalemaid/devices/:id", delete(revoke))
        .route("/_whalemaid/devices/:id/heartbeat", post(heartbeat))
        .route("/_whalemaid/devices/:id/status", get(device_status))
        .route("/_whalemaid/devices/:id/tunnel", post(tunnel))
        .route("/_whalemaid/connect", post(connect))
        .with_state(state)
}

async fn health() -> Json<Value> {
    Json(json!({ "ok": true }))
}

fn bearer(headers: &HeaderMap) -> Option<&str> {
    headers.get("authorization")?.to_str().ok().map(|v| v.strip_prefix("Bearer ").unwrap_or(v))
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
async fn register(State(s): State<Arc<AppState>>, headers: HeaderMap, body: String) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    if s.install_code.is_empty() || headers.get("x-install-code").and_then(|v| v.to_str().ok()) != Some(s.install_code.as_str()) {
        return Err(unauthorized())
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
/// 主控端拿到端口后经 rathole 隧道直连受控端网关，在网关侧完成挑战应答绑定（密码只走 noise 加密隧道）。
async fn connect(State(s): State<Arc<AppState>>, headers: HeaderMap, body: String) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let b: serde_json::Value = serde_json::from_str(&body).map_err(|_| (StatusCode::BAD_REQUEST, Json(json!({ "error": "bad body" }))))?;
    let device_id = b.get("deviceId").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let password = b.get("password").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if device_id.is_empty() || password.is_empty() {
        return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": "deviceId/password required" }))))
    }
    let ip = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()).unwrap_or("unknown").to_string();
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
    Ok((StatusCode::OK, Json(json!({ "deviceId": device_id, "service": service, "port": port }))))
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
async fn device_status(State(s): State<Arc<AppState>>, headers: HeaderMap, axum::extract::Path(id): axum::extract::Path<String>) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let ip = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()).unwrap_or("unknown").to_string();
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
