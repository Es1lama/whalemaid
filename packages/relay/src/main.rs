// SPEC: docs/PREFLIGHT.md 中继控制面入口
mod api;
mod config;
mod controller_sessions;
mod grants;
mod install_tokens;
mod limiter;
mod rathole;
mod registry;
mod tunnel;

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
    if let Ok(v) = std::env::var("WHALEMAID_RELAY_RATHOLE_BIN") {
        config.rathole_bin = PathBuf::from(&v);
    }
    // 公网部署：显式绑 0.0.0.0:9443（默认回环，防误暴露——SEC-004b 审计#1）
    if let Ok(v) = std::env::var("WHALEMAID_RELAY_TUNNEL_LISTEN") {
        config.tunnel_listen = v;
    }
    let admin_token = std::env::var("ADMIN_TOKEN").unwrap_or_default();
    // SEC-001（审计三轮#4 修订）：ADMIN_INSTALL_CODE 仅作首启种子（默认单次可消费）；日常用管理端点签发
    let install_code = std::env::var("ADMIN_INSTALL_CODE").unwrap_or_default();
    // 审计三轮#2：默认用 socket peer IP 做限速键；显式配置可信反代后才解析 X-Forwarded-For
    let trusted_proxy = std::env::var("WHALEMAID_RELAY_TRUSTED_PROXY").map(|v| v == "1" || v.eq_ignore_ascii_case("true")).unwrap_or(false);
    let max_devices = std::env::var("WHALEMAID_RELAY_MAX_DEVICES").ok().and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);

    std::fs::create_dir_all(&config.data_dir)?;

    let registry = registry::Registry::load(
        config.data_dir.join("devices.json"),
        5202, // 设备转发端口起始（rathole 服务端口段）
    )?;

    let mut install_tokens = install_tokens::InstallTokenStore::load(config.data_dir.join("install-tokens.json"))?;
    install_tokens.seed_if_new(&install_code)?;

    // SEC-001/003：rathole noise 静态密钥对（NK 25519）——持久化 0600；private 只进 rathole 配置，
    // public 经 /tunnel（TLS）下发受控端 pin。rathole 默认 transport 是 TCP 明文，必须显式 noise。
    let noise_key_path = config.data_dir.join("noise-key");
    let (noise_private_key, noise_public_key) = if noise_key_path.exists() {
        let b64 = std::fs::read_to_string(&noise_key_path)?.trim().to_string();
        let (priv_key, pub_key) = rathole::generate_noise_keypair_from_private(&b64)?;
        (priv_key, pub_key)
    } else {
        let (priv_key, pub_key) = rathole::generate_noise_keypair()?;
        use std::os::unix::fs::PermissionsExt;
        std::fs::write(&noise_key_path, &priv_key)?;
        std::fs::set_permissions(&noise_key_path, std::fs::Permissions::from_mode(0o600))?;
        println!("[whalemaid-relay] 首次生成 rathole noise 静态密钥对（{noise_key_path:?}，0600）");
        (priv_key, pub_key)
    };

    let state = Arc::new(api::AppState {
        registry: Mutex::new(registry),
        config: config.clone(),
        sidecar: Mutex::new(rathole::RatholeSidecar::new()),
        admin_token,
        install_tokens: Mutex::new(install_tokens),
        limiter: Mutex::new(limiter::Limiter::new(5, Duration::from_secs(60), 5, Duration::from_secs(300))),
        password_verify_slots: tokio::sync::Semaphore::new(8),
        ws_limiter: Mutex::new(limiter::Limiter::new(600, Duration::from_secs(60), 600, Duration::from_secs(60))),
        noise_private_key,
        noise_public_key,
        controller_sessions: Mutex::new(controller_sessions::ControllerSessionStore::new(Duration::from_secs(900))),
        grants: Mutex::new(grants::GrantStore::new(Duration::from_secs(120))),
        trusted_proxy,
        max_devices,
    });

    // sidecar 启动：rathole 服务端（首次配置=当前活跃设备）。
    // 启动失败不致命：控制面仍可服务（管理员装好 rathole 后重启容器即可）
    {
        let reg = state.registry.lock().await;
        let cfg = rathole::render_server_config(&reg, &config.rathole_bind, &state.noise_private_key);
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

    // SEC-004b：主控端隧道入口（同一证书体系构建第二个 TLS acceptor；授权靠一次性 grant）
    let tunnel_acceptor = build_tls_acceptor(&cert_path, &key_path)?;
    let tunnel_state = state.clone();
    tokio::spawn(async move {
        if let Err(e) = tunnel::serve(tunnel_state, tunnel_acceptor).await {
            eprintln!("[whalemaid-relay] 隧道入口退出: {e}");
            std::process::exit(1);
        }
    });

    // 优雅退出：Ctrl-C/SIGTERM 时先停 sidecar（rathole），再退——否则孤儿 sidecar 抢占端口（实测教训）
    let state_for_signal = state.clone();
    tokio::spawn(async move {
        #[cfg(unix)]
        {
            use tokio::signal::unix::{signal, SignalKind};
            let mut sigterm = signal(SignalKind::terminate()).expect("SIGTERM handler");
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {}
                _ = sigterm.recv() => {}
            }
        }
        #[cfg(not(unix))]
        let _ = tokio::signal::ctrl_c().await;
        println!("[whalemaid-relay] 收到退出信号，停止 rathole sidecar…");
        state_for_signal.sidecar.lock().await.stop().await;
        std::process::exit(0);
    });

    axum_server::bind_rustls(config.listen.parse()?, tls)
        .serve(app.into_make_service_with_connect_info::<std::net::SocketAddr>())
        .await?;
    Ok(())
}

fn sha256_hex(der: &[u8]) -> String {
    use sha2::Digest;
    let mut h = sha2::Sha256::new();
    h.update(der);
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// 用 API 同一张自签证书构建 TLS acceptor（隧道入口与 API 同指纹体系，客户端 pin 一个指纹即可）
fn build_tls_acceptor(cert_path: &std::path::Path, key_path: &std::path::Path) -> Result<tokio_rustls::TlsAcceptor> {
    use std::io::BufReader;
    let certs: Vec<rustls::pki_types::CertificateDer<'static>> =
        rustls_pemfile::certs(&mut BufReader::new(std::fs::File::open(cert_path)?)).collect::<std::result::Result<_, _>>()?;
    let key = rustls_pemfile::private_key(&mut BufReader::new(std::fs::File::open(key_path)?))?
        .ok_or_else(|| anyhow::anyhow!("无可用私钥"))?;
    let cfg = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(certs, key)
        .map_err(|e| anyhow::anyhow!("{e}"))?;
    Ok(tokio_rustls::TlsAcceptor::from(Arc::new(cfg)))
}
