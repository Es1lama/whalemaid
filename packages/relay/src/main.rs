// SPEC: docs/PREFLIGHT.md 中继控制面入口
mod api;
mod config;
mod rathole;
mod registry;

use anyhow::Result;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

#[tokio::main]
async fn main() -> Result<()> {
    // 环境可配（docker 部署）：WHALEMAID_RELAY_LISTEN / WHALEMAID_RELAY_DATA / ADMIN_TOKEN
    let mut config = config::RelayConfig::default();
    if let Ok(v) = std::env::var("WHALEMAID_RELAY_LISTEN") {
        config.listen = v;
    }
    if let Ok(v) = std::env::var("WHALEMAID_RELAY_DATA") {
        config.data_dir = PathBuf::from(&v);
        config.rathole_server_cfg = config.data_dir.join("rathole-server.toml");
    }
    let admin_token = std::env::var("ADMIN_TOKEN").unwrap_or_default();

    std::fs::create_dir_all(&config.data_dir)?;

    let registry = registry::Registry::load(
        config.data_dir.join("devices.json"),
        5202, // 设备转发端口起始（rathole 服务端口段）
    )?;

    let state = Arc::new(api::AppState {
        registry: Mutex::new(registry),
        config: config.clone(),
        sidecar: Mutex::new(rathole::RatholeSidecar::new()),
        admin_token,
    });

    // sidecar 启动：rathole 服务端（首次配置=当前活跃设备）。
    // 启动失败不致命：控制面仍可服务（管理员装好 rathole 后重启容器即可）
    {
        let reg = state.registry.lock().await;
        let cfg = rathole::render_server_config(&reg, &config.rathole_bind);
        std::fs::write(&config.rathole_server_cfg, &cfg)?;
        if let Err(e) = state
            .sidecar
            .lock()
            .await
            .start(&config.rathole_bin, &config.rathole_server_cfg)
            .await
        {
            eprintln!("[whalemaid-relay] rathole sidecar 启动失败（安装 rathole 后重启）: {e}");
        }
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
