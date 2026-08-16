// SPEC: docs/security-audit.md#SEC-004b 主控端隧道入口：TLS（与 API 同证书/指纹体系）→ GRANT 校验 → 转发到 127.0.0.1:<设备服务端口>
// 加密用现成 TLS（tokio-rustls），授权用一次性 grant（grants.rs），不自造协议；转发内容仍受 rathole noise 保护
use crate::api::AppState;
use crate::controller_http::ControllerRequestMarker;
use crate::limiter::Attempt;
use anyhow::Result;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_rustls::TlsAcceptor;

const MAX_LINE: usize = 256;
const LINE_TIMEOUT: Duration = Duration::from_secs(10);

pub async fn serve(state: Arc<AppState>, acceptor: TlsAcceptor) -> Result<()> {
    let listener = TcpListener::bind(&state.config.tunnel_listen).await?;
    println!("[whalemaid-relay] 隧道入口监听 tls://{}（GRANT 一次性授权，SEC-004b）", state.config.tunnel_listen);
    loop {
        let (stream, peer) = listener.accept().await?;
        let state = state.clone();
        let acceptor = acceptor.clone();
        tokio::spawn(async move {
            if let Err(e) = handle(state.clone(), acceptor, stream, peer).await {
                eprintln!("[whalemaid-relay] tunnel 会话结束: {e}");
            }
        });
    }
}

async fn handle(state: Arc<AppState>, acceptor: TlsAcceptor, stream: TcpStream, peer: std::net::SocketAddr) -> Result<()> {
    // 限速（SEC-002 同款固定窗口）：同一 IP 过多尝试直接断
    let ip = peer.ip().to_string();
    if state.limiter.lock().await.check(&format!("tunnel:{ip}")) != Attempt::Allowed {
        return Ok(());
    }

    // TLS 握手（客户端按 API 指纹固定证书，SSH TOFU 模型）
    let mut tls = tokio::time::timeout(LINE_TIMEOUT, acceptor.accept(stream))
        .await
        .map_err(|_| anyhow::anyhow!("tls handshake timeout"))??;

    // 首行协议：`GRANT <token> <deviceId>\n`（256 字节上限）
    let line = tokio::time::timeout(LINE_TIMEOUT, async {
        let mut buf = Vec::with_capacity(64);
        let mut byte = [0u8; 1];
        loop {
            if tls.read(&mut byte).await? == 0 {
                break;
            }
            buf.push(byte[0]);
            if byte[0] == b'\n' || buf.len() >= MAX_LINE {
                break;
            }
        }
        Ok::<Vec<u8>, std::io::Error>(buf)
    })
    .await
    .map_err(|_| anyhow::anyhow!("grant line timeout"))??;

    let line = String::from_utf8_lossy(&line).trim().to_string();
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() != 3 || parts[0] != "GRANT" {
        return Ok(()); // 拒绝但不泄露细节
    }
    let (token, device_id) = (parts[1].to_string(), parts[2].to_string());

    // 一次性 grant 消费（TTL+设备绑定校验；成功即得该设备服务端口）
    let Some(port) = state.grants.lock().await.consume(&token, &device_id) else {
        return Ok(());
    };

    let marked_request = tokio::time::timeout(LINE_TIMEOUT, async {
        let mut marker = ControllerRequestMarker::new();
        let mut buf = [0u8; 16 * 1024];
        loop {
            let count = tls.read(&mut buf).await?;
            if count == 0 {
                return Err(anyhow::anyhow!("controller closed before HTTP request"));
            }
            if let Some(request) = marker.push(&buf[..count])? {
                return Ok::<Vec<u8>, anyhow::Error>(request);
            }
        }
    })
    .await
    .map_err(|_| anyhow::anyhow!("controller HTTP request timeout"))??;

    let mut backend = TcpStream::connect(("127.0.0.1", port)).await?;
    backend.write_all(&marked_request).await?;
    // 双工转发：主控端 ↔ rathole 服务端口（其另一侧为受控端，noise 保护）
    let _ = tokio::io::copy_bidirectional(&mut tls, &mut backend).await?;
    Ok(())
}
