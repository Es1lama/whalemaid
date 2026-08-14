// SPEC: docs/PREFLIGHT.md 控制面管理 API（仅本机：插件/控制台调用，不对外）
use crate::config::RelayConfig;
use crate::rathole::{render_server_config, RatholeSidecar};
use crate::registry::Registry;
use anyhow::Result;
use axum::{extract::State, routing::{get, post, delete}, Json, Router};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::sync::Mutex;

pub struct AppState {
    pub registry: Mutex<Registry>,
    pub config: RelayConfig,
    pub sidecar: Mutex<RatholeSidecar>,
}

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/devices", post(register).get(list))
        .route("/devices/:id", delete(revoke))
        .with_state(state)
}

async fn health() -> Json<Value> {
    Json(json!({ "ok": true }))
}

async fn register(State(s): State<Arc<AppState>>) -> Result<Json<Value>, String> {
    let (record, token) = s.registry.lock().await.register().map_err(|e| e.to_string())?;
    {
        let reg = s.registry.lock().await;
        let cfg = render_server_config(&reg, &s.config.rathole_bind);
        s.sidecar
            .lock()
            .await
            .reload(&s.config.rathole_server_cfg, &cfg)
            .map_err(|e| e.to_string())?;
    }
    Ok(Json(json!({ "id": record.id, "service": record.service, "port": record.port, "token": token })))
}

async fn list(State(s): State<Arc<AppState>>) -> Result<Json<Value>, String> {
    let reg = s.registry.lock().await;
    let devices: Vec<Value> = reg
        .active()
        .map(|d| json!({ "id": d.id, "port": d.port, "revoked": d.revoked }))
        .collect();
    Ok(Json(json!({ "devices": devices })))
}

async fn revoke(State(s): State<Arc<AppState>>, axum::extract::Path(id): axum::extract::Path<String>) -> Result<Json<Value>, String> {
    let found = s.registry.lock().await.revoke(&id);
    {
        let reg = s.registry.lock().await;
        let cfg = render_server_config(&reg, &s.config.rathole_bind);
        s.sidecar
            .lock()
            .await
            .reload(&s.config.rathole_server_cfg, &cfg)
            .map_err(|e| e.to_string())?;
    }
    Ok(Json(json!({ "revoked": found })))
}
