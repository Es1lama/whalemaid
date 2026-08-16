// SPEC: docs/security-audit.md#SEC-001/002/003 控制面 API：安装码注册、每设备凭据、/connect 密码匹配+限速（隧道 token 注册后固定，授权在受控端网关侧）
// SPEC: docs/threat-model.md#TM-005 心跳/在线状态/吊销
use crate::config::RelayConfig;
use crate::controller_sessions::{ControllerSessionStore, CredentialKind};
use crate::grants::GrantStore;
use crate::install_tokens::InstallTokenStore;
use crate::limiter::{Attempt, Limiter};
use crate::rathole::{render_server_config, RatholeSidecar};
use crate::registry::{verify_password, Registry, TemporaryCredentialError, TemporaryCredentialState};
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
use tokio::sync::{Mutex, Semaphore};
use uuid::Uuid;

pub const HEARTBEAT_TIMEOUT_SECS: u64 = 45;

pub struct AppState {
    pub registry: Mutex<Registry>,
    pub config: RelayConfig,
    pub sidecar: Mutex<RatholeSidecar>,
    /// 管理员令牌（列表/管理操作）
    pub admin_token: String,
    /// 可消费安装令牌（SEC-001，审计三轮#4 修订）：只存哈希；签发/消耗见 InstallTokenStore
    pub install_tokens: Mutex<InstallTokenStore>,
    /// /connect 限速与锁定（SEC-002）
    pub limiter: Mutex<Limiter>,
    /// scrypt 验证并发上限：验证在 blocking 池执行，但不能让攻击请求无限占用 CPU/内存。
    pub password_verify_slots: Semaphore,
    /// WSS 隧道入口泛洪上限（宽松；grant 单次消费+TLL 已防滥用，逐请求建连是合法高频）
    pub ws_limiter: Mutex<Limiter>,
    /// 仅在显式配置可信反代时解析 X-Forwarded-For（审计三轮#2：默认用 socket peer IP）
    pub trusted_proxy: bool,
    /// 设备配额（审计三轮#4 缓解：enrollment secret 泄露时限制可注册设备数；0 = 不限）
    pub max_devices: u64,
    /// rathole noise 静态密钥对（SEC-001/003）：private 只进配置文件；public 经 /tunnel 下发受控端 pin
    pub noise_private_key: String,
    pub noise_public_key: String,
    /// 主控端短期认证会话（SEC-002）：只在内存，绑定 IP + 设备，密码轮换/吊销清除。
    pub controller_sessions: Mutex<ControllerSessionStore>,
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
        .route("/_whalemaid/devices/:id/temporary-password", post(issue_temporary_password).delete(revoke_temporary_password))
        .route("/_whalemaid/connect", post(connect))
        .route("/_whalemaid/tunnel-ws", get(tunnel_ws))
        .route("/_whalemaid/admin/install-tokens", post(issue_install_token).get(list_install_tokens))
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

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn credential_kind_name(kind: CredentialKind) -> &'static str {
    match kind {
        CredentialKind::LongTerm => "longTerm",
        CredentialKind::Temporary => "temporary",
    }
}

fn temporary_state_name(state: &TemporaryCredentialState) -> &'static str {
    match state {
        TemporaryCredentialState::None => "none",
        TemporaryCredentialState::Active => "active",
        TemporaryCredentialState::Consumed => "consumed",
        TemporaryCredentialState::Revoked => "revoked",
        TemporaryCredentialState::Expired => "expired",
    }
}

fn temporary_credential_error(error: TemporaryCredentialError) -> (StatusCode, Json<Value>) {
    let (status, code) = match error {
        TemporaryCredentialError::UnknownDevice => (StatusCode::NOT_FOUND, "DEVICE_NOT_FOUND"),
        TemporaryCredentialError::Expired => (StatusCode::UNAUTHORIZED, "CREDENTIAL_EXPIRED"),
        TemporaryCredentialError::Consumed => (StatusCode::CONFLICT, "CREDENTIAL_CONSUMED"),
        TemporaryCredentialError::Revoked => (StatusCode::UNAUTHORIZED, "CREDENTIAL_REVOKED"),
        TemporaryCredentialError::Superseded => (StatusCode::CONFLICT, "CREDENTIAL_SUPERSEDED"),
        TemporaryCredentialError::NotConfigured => (StatusCode::UNAUTHORIZED, "INVALID_CREDENTIAL"),
    };
    (status, Json(json!({ "error": code })))
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

/// SEC-001：受控端首次注册——需可消费安装令牌（默认单次+可选 TTL）；签发每设备凭据与初始隧道 token
async fn register(State(s): State<Arc<AppState>>, ConnectInfo(peer): ConnectInfo<std::net::SocketAddr>, headers: HeaderMap, body: String) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let code = headers.get("x-install-code").and_then(|v| v.to_str().ok()).unwrap_or("");
    // 审计三轮#4：enrollment secret 为长期共享秘密——按 IP 限速 + 设备配额双闸防批量注册
    if s.limiter.lock().await.consume(&format!("register:{}", client_ip(&s, &headers, Some(peer)))) != Attempt::Allowed {
        return Err((StatusCode::TOO_MANY_REQUESTS, Json(json!({ "error": "rate-limited" }))))
    }
    if s.max_devices > 0 {
        let count = { let reg = s.registry.lock().await; reg.active().count() as u64 };
        if count >= s.max_devices {
            return Err((StatusCode::CONFLICT, Json(json!({ "error": "device-quota-reached" }))))
        }
    }
    let b: serde_json::Value = serde_json::from_str(&body).map_err(|_| (StatusCode::BAD_REQUEST, Json(json!({ "error": "bad body" }))))?;
    let device_id = b.get("deviceId").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let password_digest = b.get("passwordDigest").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if device_id.is_empty() || password_digest.is_empty() {
        return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": "deviceId/passwordDigest required" }))))
    }
    // 单次令牌不可浪费在注定失败的注册上：先查设备占用（409 不消耗令牌），
    // 否则宿主重试循环一次 409 就烧掉一个令牌，管理员吊销后反而无法再注册
    if s.registry.lock().await.active().any(|d| d.id == device_id) {
        return Err((StatusCode::CONFLICT, Json(json!({ "error": "device-already-registered" }))))
    }
    if !s.install_tokens.lock().await.verify_and_consume(code) {
        return Err(unauthorized())
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

/// SEC-002：首次用设备编号+密码做 scrypt，签 15min 主控会话；后续凭会话令牌快速认证。
/// SEC-003：只做主控授权与寻址，**不轮换隧道 token**（token 是受控端侧固定凭据）。
/// SEC-004b：每次认证后仍签发**短时一次性 grant**（2min、单次消费）；响应不含设备服务端口。
async fn connect(State(s): State<Arc<AppState>>, ConnectInfo(peer): ConnectInfo<std::net::SocketAddr>, headers: HeaderMap, body: String) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let b: Value = serde_json::from_str(&body).map_err(|_| (StatusCode::BAD_REQUEST, Json(json!({ "error": "bad body" }))))?;
    let device_id = b.get("deviceId").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let password = b.get("password").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let supplied_session = b.get("sessionToken").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if device_id.is_empty() || (password.is_empty() == supplied_session.is_empty()) {
        return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": "deviceId and exactly one of password/sessionToken required" }))))
    }
    let ip = client_ip(&s, &headers, Some(peer));

    let (service, port, session_token, credential_kind, session_ttl_sec) = if !supplied_session.is_empty() {
        let key = format!("session-token:{ip}:{device_id}");
        match s.limiter.lock().await.check(&key) {
            Attempt::RateLimited => return Err((StatusCode::TOO_MANY_REQUESTS, Json(json!({ "error": "RATE_LIMITED" })))),
            Attempt::Locked => return Err((StatusCode::LOCKED, Json(json!({ "error": "LOCKED" })))),
            Attempt::Allowed => {}
        }
        let session = s.controller_sessions.lock().await.validate_session(&supplied_session, &device_id, &ip);
        let session_current = match session {
            Some((CredentialKind::LongTerm, _, None)) => true,
            Some((CredentialKind::Temporary, _, Some(generation))) => {
                s.registry.lock().await.temporary_password_status(&device_id, now_secs())
                    .map(|value| {
                        value.generation == generation
                            && value.state == TemporaryCredentialState::Consumed
                    })
                    .unwrap_or(false)
            }
            _ => false,
        };
        let route = if session_current {
            let reg = s.registry.lock().await;
            let found = reg.active().find(|dev| dev.id == device_id).map(|dev| (dev.service.clone(), dev.port));
            found
        } else {
            None
        };
        let (Some((kind, remaining, _)), Some((service, port))) = (session, route) else {
            s.limiter.lock().await.record_fail(&key);
            return Err((StatusCode::UNAUTHORIZED, Json(json!({ "error": "INVALID_SESSION" }))))
        };
        s.limiter.lock().await.record_success(&key);
        (service, port, supplied_session, kind, remaining)
    } else {
        let requested_kind = match b.get("credentialKind").and_then(|v| v.as_str()).unwrap_or("longTerm") {
            "longTerm" => CredentialKind::LongTerm,
            "temporary" => CredentialKind::Temporary,
            _ => return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": "credentialKind must be longTerm or temporary" })))),
        };
        let key = format!("{ip}:{device_id}:{}", credential_kind_name(requested_kind));
        match s.limiter.lock().await.check(&key) {
            Attempt::RateLimited => return Err((StatusCode::TOO_MANY_REQUESTS, Json(json!({ "error": "RATE_LIMITED" })))),
            Attempt::Locked => return Err((StatusCode::LOCKED, Json(json!({ "error": "LOCKED" })))),
            Attempt::Allowed => {}
        }

        let (password_digest, service, port, temporary_generation, temporary_expires_at) = match requested_kind {
            CredentialKind::LongTerm => {
                let candidate = {
                    let reg = s.registry.lock().await;
                    let found = reg.active()
                        .find(|dev| dev.id == device_id)
                        .map(|dev| (dev.password_digest.clone(), dev.service.clone(), dev.port));
                    found
                };
                let Some((digest, service, port)) = candidate else {
                    s.limiter.lock().await.record_fail(&key);
                    return Err((StatusCode::UNAUTHORIZED, Json(json!({ "error": "INVALID_CREDENTIAL" }))))
                };
                (digest, service, port, None, None)
            }
            CredentialKind::Temporary => {
                let candidate = s.registry.lock().await.temporary_password_candidate(&device_id, now_secs())
                    .map_err(temporary_credential_error)?;
                let route = {
                    let reg = s.registry.lock().await;
                    let found = reg.active().find(|dev| dev.id == device_id).map(|dev| (dev.service.clone(), dev.port));
                    found
                };
                let Some((service, port)) = route else {
                    return Err(temporary_credential_error(TemporaryCredentialError::UnknownDevice))
                };
                (candidate.digest, service, port, Some(candidate.generation), Some(candidate.expires_at))
            }
        };

        let permit = s.password_verify_slots.acquire().await.map_err(|_| (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "error": "PASSWORD_VERIFIER_UNAVAILABLE" })),
        ))?;
        let password_for_verify = password.clone();
        let digest_for_verify = password_digest.clone();
        let verified = tokio::task::spawn_blocking(move || verify_password(&password_for_verify, &digest_for_verify))
            .await
            .unwrap_or(false);
        drop(permit);
        if !verified {
            s.limiter.lock().await.record_fail(&key);
            return Err((StatusCode::UNAUTHORIZED, Json(json!({ "error": "INVALID_CREDENTIAL" }))))
        }

        let session_ttl = match requested_kind {
            CredentialKind::LongTerm => {
                let still_current = {
                    let reg = s.registry.lock().await;
                    let current = reg.active().any(|dev| dev.id == device_id && dev.password_digest == password_digest);
                    current
                };
                if !still_current {
                    s.limiter.lock().await.record_fail(&key);
                    return Err((StatusCode::UNAUTHORIZED, Json(json!({ "error": "INVALID_CREDENTIAL" }))))
                }
                900
            }
            CredentialKind::Temporary => {
                let generation = temporary_generation.expect("temporary generation");
                s.registry.lock().await.consume_temporary_password(&device_id, generation, now_secs())
                    .map_err(temporary_credential_error)?;
                temporary_expires_at.unwrap_or(0).saturating_sub(now_secs()).clamp(1, 900)
            }
        };
        s.limiter.lock().await.record_success(&key);
        { s.registry.lock().await.note_connect(&device_id); }
        let token = Uuid::new_v4().simple().to_string();
        s.controller_sessions.lock().await.issue_with_ttl(
            token.clone(),
            device_id.clone(),
            ip.clone(),
            requested_kind,
            std::time::Duration::from_secs(session_ttl),
            temporary_generation,
        );
        (service, port, token, requested_kind, session_ttl)
    };

    let grant = Uuid::new_v4().simple().to_string();
    s.grants.lock().await.issue(grant.clone(), device_id.clone(), port);
    let tunnel_port = s.config.tunnel_listen.rsplit(':').next().and_then(|p| p.parse::<u16>().ok()).unwrap_or(9443);
    Ok((StatusCode::OK, Json(json!({
        "deviceId": device_id, "service": service,
        "credentialKind": credential_kind_name(credential_kind),
        "sessionToken": session_token, "sessionTtlSec": session_ttl_sec,
        "grant": grant, "grantTtlSec": 120, "tunnelPort": tunnel_port,
    }))))
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
    s.controller_sessions.lock().await.clear_device(&id);
    s.grants.lock().await.clear_device(&id);
    Ok((StatusCode::OK, Json(json!({ "ok": true }))))
}

/** REQ-003：受控插件凭设备凭据签发/刷新短期密码；TTL 只采用中继时钟并限制为 1 分钟到 24 小时。 */
async fn issue_temporary_password(
    State(s): State<Arc<AppState>>,
    headers: HeaderMap,
    axum::extract::Path(id): axum::extract::Path<String>,
    body: String,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let Some(cred) = bearer(&headers) else { return Err(unauthorized()) };
    let authorized = { s.registry.lock().await.authenticate_credential(cred).map(|d| d.id == id).unwrap_or(false) };
    if !authorized {
        return Err(unauthorized())
    }
    let b: Value = serde_json::from_str(&body)
        .map_err(|_| (StatusCode::BAD_REQUEST, Json(json!({ "error": "bad body" }))))?;
    let digest = b.get("passwordDigest").and_then(|v| v.as_str()).unwrap_or("");
    let ttl_sec = b.get("ttlSec").and_then(|v| v.as_u64()).unwrap_or(0);
    if !digest.starts_with("$scrypt$") || digest.len() > 512 {
        return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": "invalid passwordDigest" }))))
    }
    if !(60..=86_400).contains(&ttl_sec) {
        return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": "ttlSec must be between 60 and 86400" }))))
    }
    let issued = s
        .registry
        .lock()
        .await
        .issue_temporary_password(&id, digest, ttl_sec, now_secs())
        .map_err(|_| (StatusCode::NOT_FOUND, Json(json!({ "error": "DEVICE_NOT_FOUND" }))))?;
    s.controller_sessions.lock().await.clear_temporary_device(&id);
    s.grants.lock().await.clear_device(&id);
    Ok((StatusCode::OK, Json(json!({
        "state": "active",
        "expiresAt": issued.expires_at,
        "generation": issued.generation,
    }))))
}

/** REQ-003：撤销尚未消费的短期密码，并清除该设备的临时控制会话与待消费 grant。 */
async fn revoke_temporary_password(
    State(s): State<Arc<AppState>>,
    headers: HeaderMap,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let Some(cred) = bearer(&headers) else { return Err(unauthorized()) };
    let authorized = { s.registry.lock().await.authenticate_credential(cred).map(|d| d.id == id).unwrap_or(false) };
    if !authorized {
        return Err(unauthorized())
    }
    let revoked = s.registry.lock().await.revoke_temporary_password(&id);
    s.controller_sessions.lock().await.clear_temporary_device(&id);
    s.grants.lock().await.clear_device(&id);
    Ok((StatusCode::OK, Json(json!({ "state": if revoked { "revoked" } else { "unchanged" } }))))
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

/// SEC-001（审计三轮#4 修订）：管理员签发可消费安装令牌——明文仅返回这一次
async fn issue_install_token(State(s): State<Arc<AppState>>, headers: HeaderMap, body: String) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    if s.admin_token.is_empty() || bearer(&headers) != Some(s.admin_token.as_str()) {
        return Err(unauthorized())
    }
    let b: serde_json::Value = serde_json::from_str(&body).unwrap_or(json!({}));
    let max_uses = b.get("maxUses").and_then(|v| v.as_u64()).unwrap_or(1);
    let ttl_sec = b.get("ttlSec").and_then(|v| v.as_u64());
    let token = s.install_tokens.lock().await.issue(max_uses, ttl_sec).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))?;
    Ok((StatusCode::CREATED, Json(json!({ "token": token, "maxUses": max_uses, "ttlSec": ttl_sec }))))
}

/// 令牌清单（不含明文/哈希）
async fn list_install_tokens(State(s): State<Arc<AppState>>, headers: HeaderMap) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    if s.admin_token.is_empty() || bearer(&headers) != Some(s.admin_token.as_str()) {
        return Err(unauthorized())
    }
    Ok((StatusCode::OK, Json(json!({ "tokens": s.install_tokens.lock().await.list() }))))
}

async fn heartbeat(State(s): State<Arc<AppState>>, headers: HeaderMap, axum::extract::Path(id): axum::extract::Path<String>) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {    let Some(cred) = bearer(&headers) else { return Err(unauthorized()) };
    let authorized = { s.registry.lock().await.authenticate_credential(cred).map(|d| d.id == id).unwrap_or(false) };
    if !authorized {
        return Err(unauthorized())
    }
    let mut reg = s.registry.lock().await;
    let known = reg.touch(&id);
    if !known {
        return Ok((StatusCode::NOT_FOUND, Json(json!({ "error": "unknown-device" }))))
    }
    let connect_events = reg.take_connect_events(&id);
    let temporary = reg.temporary_password_status(&id, now_secs()).ok();
    Ok((StatusCode::OK, Json(json!({
        "ok": true,
        "connectEvents": connect_events,
        "temporaryPassword": temporary.map(|value| json!({
            "state": temporary_state_name(&value.state),
            "expiresAt": value.expires_at,
            "generation": value.generation,
        })),
    }))))
}

/// audit#4（D-026）：主控端按设备编号查询状态——Phase A 无账号，设备列表 = 主控端本机记忆 + 本端点逐个查询；
/// 不回 IP/端口/token（DESIGN §6.3 不泄露约束）；按 IP 限速防编号枚举；未知与离线区分（registered 位）
async fn device_status(State(s): State<Arc<AppState>>, ConnectInfo(peer): ConnectInfo<std::net::SocketAddr>, headers: HeaderMap, axum::extract::Path(id): axum::extract::Path<String>) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    let ip = client_ip(&s, &headers, Some(peer));
    if s.limiter.lock().await.consume(&format!("status:{ip}")) != Attempt::Allowed {
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
    if found {
        s.controller_sessions.lock().await.clear_device(&id);
        s.grants.lock().await.clear_device(&id);
    }
    reload_config(&s).await.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e }))))?;
    Ok((StatusCode::OK, Json(json!({ "revoked": found }))))
}

/// SEC-004b Web 变体（主控端 Web/Electron/Capacitor 统一入口，audit#6）：
/// 浏览器无法开裸 TLS 隧道，故经 WSS 承载同一条 grant 管道——首个文本帧 `GRANT <token> <deviceId>`，
/// 之后帧 = 原始字节（HTTP 请求等），双工转发到受控端 rathole 服务端口。限速 + 单次消费 + 设备绑定同裸 TLS 入口。
async fn tunnel_ws(State(s): State<Arc<AppState>>, ConnectInfo(peer): ConnectInfo<std::net::SocketAddr>, headers: HeaderMap, ws: WebSocketUpgrade) -> Response {
    let ip = client_ip(&s, &headers, Some(peer));
    if s.ws_limiter.lock().await.consume(&format!("tunnelws:{ip}")) != Attempt::Allowed {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::controller_sessions::{ControllerSessionStore, CredentialKind};
    use crate::grants::GrantStore;
    use crate::install_tokens::InstallTokenStore;
    use crate::limiter::Limiter;
    use crate::registry::{hash_password, Registry};
    use axum::body::Body;
    use http_body_util::BodyExt;
    use std::net::SocketAddr;
    use std::time::Duration;
    use tower::ServiceExt;

    async fn test_app() -> (Router, Arc<AppState>, String, String) {
        let dir = std::env::temp_dir().join(format!("whalemaid-relay-api-test-{}", Uuid::new_v4()));
        let mut registry = Registry::load(dir.join("devices.json"), 5202).unwrap();
        let device_id = "WHALE-TEST-TEMP".to_string();
        let (_, credential, _) = registry
            .register(&device_id, &hash_password("LONG-PASSWORD").unwrap())
            .unwrap();
        let state = Arc::new(AppState {
            registry: Mutex::new(registry),
            config: RelayConfig::default(),
            sidecar: Mutex::new(RatholeSidecar::new()),
            admin_token: "admin".into(),
            install_tokens: Mutex::new(InstallTokenStore::load(dir.join("install-tokens.json")).unwrap()),
            limiter: Mutex::new(Limiter::new(50, Duration::from_secs(60), 50, Duration::from_secs(60))),
            password_verify_slots: Semaphore::new(4),
            ws_limiter: Mutex::new(Limiter::new(50, Duration::from_secs(60), 50, Duration::from_secs(60))),
            trusted_proxy: false,
            max_devices: 0,
            noise_private_key: "test-private".into(),
            noise_public_key: "test-public".into(),
            controller_sessions: Mutex::new(ControllerSessionStore::new(Duration::from_secs(900))),
            grants: Mutex::new(GrantStore::new(Duration::from_secs(120))),
        });
        (router(state.clone()), state, device_id, credential)
    }

    async fn call(app: &Router, method: &str, path: &str, body: Value, credential: Option<&str>) -> (StatusCode, Value) {
        let mut request = axum::http::Request::builder()
            .method(method)
            .uri(path)
            .header("content-type", "application/json");
        if let Some(credential) = credential {
            request = request.header("authorization", format!("Bearer {credential}"));
        }
        let request = request
            .extension(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 43123))))
            .body(Body::from(body.to_string()))
            .unwrap();
        let response = app.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let value = serde_json::from_slice(&bytes).unwrap_or_else(|_| json!({ "raw": String::from_utf8_lossy(&bytes) }));
        (status, value)
    }

    #[tokio::test]
    async fn temporary_password_http_flow_is_one_time_but_session_can_issue_more_grants() {
        let (app, _state, device_id, credential) = test_app().await;
        let digest = hash_password("WMT-ABCD-EFGH").unwrap();
        let (issue_status, issue) = call(
            &app,
            "POST",
            &format!("/_whalemaid/devices/{device_id}/temporary-password"),
            json!({ "passwordDigest": digest, "ttlSec": 600 }),
            Some(&credential),
        ).await;
        assert_eq!(issue_status, StatusCode::OK);
        assert_eq!(issue["state"], "active");

        let (connect_status, connected) = call(
            &app,
            "POST",
            "/_whalemaid/connect",
            json!({ "deviceId": device_id, "password": "WMT-ABCD-EFGH", "credentialKind": "temporary" }),
            None,
        ).await;
        assert_eq!(connect_status, StatusCode::OK);
        assert_eq!(connected["credentialKind"], "temporary");
        let session_token = connected["sessionToken"].as_str().unwrap().to_string();

        let (second_status, second) = call(
            &app,
            "POST",
            "/_whalemaid/connect",
            json!({ "deviceId": device_id, "password": "WMT-ABCD-EFGH", "credentialKind": "temporary" }),
            None,
        ).await;
        assert_eq!(second_status, StatusCode::CONFLICT);
        assert_eq!(second["error"], "CREDENTIAL_CONSUMED");

        let (resume_status, resumed) = call(
            &app,
            "POST",
            "/_whalemaid/connect",
            json!({ "deviceId": device_id, "sessionToken": session_token }),
            None,
        ).await;
        assert_eq!(resume_status, StatusCode::OK);
        assert_eq!(resumed["credentialKind"], "temporary");
        assert!(resumed["grant"].as_str().is_some());
    }

    #[tokio::test]
    async fn refresh_and_revoke_clear_temporary_sessions_without_breaking_long_password() {
        let (app, state, device_id, credential) = test_app().await;
        let endpoint = format!("/_whalemaid/devices/{device_id}/temporary-password");
        let (_, first_issue) = call(
            &app,
            "POST",
            &endpoint,
            json!({ "passwordDigest": hash_password("WMT-ONE1-TWO2").unwrap(), "ttlSec": 600 }),
            Some(&credential),
        ).await;
        let (_, connected) = call(
            &app,
            "POST",
            "/_whalemaid/connect",
            json!({ "deviceId": device_id, "password": "WMT-ONE1-TWO2", "credentialKind": "temporary" }),
            None,
        ).await;
        let old_session = connected["sessionToken"].as_str().unwrap().to_string();

        let (refresh_status, _) = call(
            &app,
            "POST",
            &endpoint,
            json!({ "passwordDigest": hash_password("WMT-NEW1-TWO2").unwrap(), "ttlSec": 600 }),
            Some(&credential),
        ).await;
        assert_eq!(refresh_status, StatusCode::OK);
        let (old_status, _) = call(
            &app,
            "POST",
            "/_whalemaid/connect",
            json!({ "deviceId": device_id, "sessionToken": old_session }),
            None,
        ).await;
        assert_eq!(old_status, StatusCode::UNAUTHORIZED);

        // 模拟旧认证在 refresh 清理之后才落 session；generation 复核仍必须拒绝。
        state.controller_sessions.lock().await.issue_with_ttl(
            "raced-old-session".into(),
            device_id.clone(),
            "127.0.0.1".into(),
            CredentialKind::Temporary,
            Duration::from_secs(60),
            first_issue["generation"].as_u64(),
        );
        let (raced_status, _) = call(
            &app,
            "POST",
            "/_whalemaid/connect",
            json!({ "deviceId": device_id, "sessionToken": "raced-old-session" }),
            None,
        ).await;
        assert_eq!(raced_status, StatusCode::UNAUTHORIZED);

        let (revoke_status, _) = call(&app, "DELETE", &endpoint, json!({}), Some(&credential)).await;
        assert_eq!(revoke_status, StatusCode::OK);
        let (revoked_status, revoked) = call(
            &app,
            "POST",
            "/_whalemaid/connect",
            json!({ "deviceId": device_id, "password": "WMT-NEW1-TWO2", "credentialKind": "temporary" }),
            None,
        ).await;
        assert_eq!(revoked_status, StatusCode::UNAUTHORIZED);
        assert_eq!(revoked["error"], "CREDENTIAL_REVOKED");

        let (long_status, long) = call(
            &app,
            "POST",
            "/_whalemaid/connect",
            json!({ "deviceId": device_id, "password": "LONG-PASSWORD", "credentialKind": "longTerm" }),
            None,
        ).await;
        assert_eq!(long_status, StatusCode::OK);
        assert_eq!(long["credentialKind"], "longTerm");
    }
}
