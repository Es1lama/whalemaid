// SPEC: docs/PREFLIGHT.md 控制面管理 API（ADMIN_TOKEN 鉴权；/health 公开）
// SPEC: docs/threat-model.md#TM-005/011 心跳与在线状态（只记元数据）
use crate::config::RelayConfig;
use crate::rathole::{render_server_config, RatholeSidecar};
use crate::registry::Registry;
use anyhow::Result;
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::{delete, get, post},
    Json, Router,
};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::sync::Mutex;

/// 心跳超时：超过则视为离线（在线状态仅读时计算，不落盘）
pub const HEARTBEAT_TIMEOUT_SECS: u64 = 45;

pub struct AppState {
    pub registry: Mutex<Registry>,
    pub config: RelayConfig,
    pub sidecar: Mutex<RatholeSidecar>,
    /// 管理 API 共享密钥（docker 部署时必设；为空 = 仅本机信任）
    pub admin_token: String,
}

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/devices", post(register).get(list))
        .route("/devices/:id", delete(revoke))
        .route("/devices/:id/heartbeat", post(heartbeat))
        .with_state(state)
}

async fn health() -> Json<Value> {
    Json(json!({ "ok": true }))
}

/// Bearer 校验：admin_token 为空时放行（单机 loopback 部署）；设置了则强制校验
fn authorized(headers: &HeaderMap, admin_token: &str) -> bool {
    if admin_token.is_empty() {
        return true
    }
    headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .map(|v| v == format!("Bearer {admin_token}"))
        .unwrap_or(false)
}

fn unauthorized() -> (StatusCode, Json<Value>) {
    (StatusCode::UNAUTHORIZED, Json(json!({ "error": "unauthorized" })))
}

async fn register(State(s): State<Arc<AppState>>, headers: HeaderMap) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    if !authorized(&headers, &s.admin_token) {
        return Err(unauthorized())
    }
    let (record, token) = s.registry.lock().await.register().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))?;
    {
        let reg = s.registry.lock().await;
        let cfg = render_server_config(&reg, &s.config.rathole_bind);
        s.sidecar
            .lock()
            .await
            .reload(&s.config.rathole_server_cfg, &cfg)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))?;
    }
    Ok((StatusCode::OK, Json(json!({ "id": record.id, "service": record.service, "port": record.port, "token": token }))))
}

async fn list(State(s): State<Arc<AppState>>, headers: HeaderMap) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    if !authorized(&headers, &s.admin_token) {
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

async fn heartbeat(State(s): State<Arc<AppState>>, headers: HeaderMap, axum::extract::Path(id): axum::extract::Path<String>) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    if !authorized(&headers, &s.admin_token) {
        return Err(unauthorized())
    }
    let known = s.registry.lock().await.touch(&id);
    if !known {
        return Ok((StatusCode::NOT_FOUND, Json(json!({ "error": "unknown-device" }))))
    }
    Ok((StatusCode::OK, Json(json!({ "ok": true }))))
}

async fn revoke(State(s): State<Arc<AppState>>, headers: HeaderMap, axum::extract::Path(id): axum::extract::Path<String>) -> Result<(StatusCode, Json<Value>), (StatusCode, Json<Value>)> {
    if !authorized(&headers, &s.admin_token) {
        return Err(unauthorized())
    }
    let found = s.registry.lock().await.revoke(&id);
    {
        let reg = s.registry.lock().await;
        let cfg = render_server_config(&reg, &s.config.rathole_bind);
        s.sidecar
            .lock()
            .await
            .reload(&s.config.rathole_server_cfg, &cfg)
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": e.to_string() }))))?;
    }
    Ok((StatusCode::OK, Json(json!({ "revoked": found }))))
}
