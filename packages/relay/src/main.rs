// SPEC: docs/PREFLIGHT.md 中继控制面入口
mod api;
mod config;
mod rathole;
mod registry;

use anyhow::Result;
use std::sync::Arc;
use tokio::sync::Mutex;

#[tokio::main]
async fn main() -> Result<()> {
    let config = config::RelayConfig::default();
    std::fs::create_dir_all(&config.data_dir)?;

    let registry = registry::Registry::load(
        config.data_dir.join("devices.json"),
        5202, // 设备转发端口起始（rathole 服务端口段）
    )?;

    let state = Arc::new(api::AppState {
        registry: Mutex::new(registry),
        config: config.clone(),
        sidecar: Mutex::new(rathole::RatholeSidecar::new()),
    });

    // sidecar 启动：rathole 服务端（首次配置=当前活跃设备）
    {
        let reg = state.registry.lock().await;
        let cfg = rathole::render_server_config(&reg, &config.rathole_bind);
        std::fs::write(&config.rathole_server_cfg, &cfg)?;
        state
            .sidecar
            .lock()
            .await
            .start(&config.rathole_bin, &config.rathole_server_cfg)
            .await?;
    }

    let app = api::router(state.clone());
    let listener = tokio::net::TcpListener::bind(&config.listen).await?;
    println!("[whalemaid-relay] 控制面监听 http://{}", config.listen);

    // 优雅退出：Ctrl-C 时先停 sidecar（rathole），再退
    let state_for_signal = state.clone();
    tokio::spawn(async move {
        let _ = tokio::signal::ctrl_c().await;
        state_for_signal.sidecar.lock().await.stop().await;
        std::process::exit(0);
    });

    axum::serve(listener, app).await?;
    Ok(())
}
