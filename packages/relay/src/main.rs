// SPEC: docs/PREFLIGHT.md 中继控制面入口
mod api;
mod config;
mod limiter;
mod rathole;
mod registry;

use anyhow::Result;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;

#[tokio::main]
async fn main() -> Result<()> {
    // 环境可配（docker 部署）：WHALEMAID_RELAY_LISTEN / WHALEMAID_RELAY_DATA / ADMIN_TOKEN / ADMIN_INSTALL_CODE
    let mut config = config::RelayConfig::default();
    if let Ok(v) = std::env::var("WHALEMAID_RELAY_LISTEN") {
        config.listen = v;
    }
    if let Ok(v) = std::env::var("WHALEMAID_RELAY_DATA") {
        config.data_dir = PathBuf::from(&v);
        config.rathole_server_cfg = config.data_dir.join("rathole-server.toml");
    }
    let admin_token = std::env::var("ADMIN_TOKEN").unwrap_or_default();
    let install_code = std::env::var("ADMIN_INSTALL_CODE").unwrap_or_default();

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
        install_code,
        limiter: Mutex::new(limiter::Limiter::new(5, Duration::from_secs(60), 5, Duration::from_secs(300))),
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

    // SEC-001：控制面仅 TLS（自签证书启动时生成/复用；指纹打印供受控端固定，SSH 式 TOFU）
    let cert_path = config.data_dir.join("relay-cert.pem");
    let key_path = config.data_dir.join("relay-key.pem");
    if !cert_path.exists() {
        let cert = rcgen::generate_simple_self_signed(vec!["whalemaid-relay".to_string()])
            .map_err(|e| anyhow::anyhow!("{e}"))?;
        std::fs::write(&cert_path, cert.cert.pem()).map_err(|e| anyhow::anyhow!("{e}"))?;
        std::fs::write(&key_path, cert.key_pair.serialize_pem()).map_err(|e| anyhow::anyhow!("{e}"))?;
        println!(
            "[whalemaid-relay] 首次生成自签证书，指纹（受控端 relayFingerprint 固定此值）: {}",
            sha256_hex(cert.cert.der().as_ref())
        );
    }
    let tls = axum_server::tls_rustls::RustlsConfig::from_pem_file(&cert_path, &key_path)
        .await
        .map_err(|e| anyhow::anyhow!("{e}"))?;
    println!("[whalemaid-relay] 控制面监听 https://{}（TLS）", config.listen);

    // 优雅退出：Ctrl-C 时先停 sidecar（rathole），再退
    let state_for_signal = state.clone();
    tokio::spawn(async move {
        let _ = tokio::signal::ctrl_c().await;
        state_for_signal.sidecar.lock().await.stop().await;
        std::process::exit(0);
    });

    axum_server::bind_rustls(config.listen.parse()?, tls).serve(app.into_make_service()).await?;
    Ok(())
}

fn sha256_hex(der: &[u8]) -> String {
    use sha2::Digest;
    let mut h = sha2::Sha256::new();
    h.update(der);
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}
