// SPEC: docs/adr/INDEX.md#ADR-032 rathole sidecar：写配置→热重载（notify watcher）→增删设备即生效
// SPEC: docs/security-audit.md#SEC-001/003 信道加密：rathole 默认 transport 是 TCP 明文（config.rs TransportType::default=Tcp），
//      必须显式 noise（Noise_NK_25519_ChaChaPoly_BLAKE2s）+ 服务端静态密钥 + 受控端 pin 服务端公钥
use crate::registry::Registry;
use anyhow::Result;
use std::process::Stdio;
use tokio::process::{Child, Command};

/// rathole 同款密钥生成（snowstorm 0.4 = rathole 依赖；NK 25519 静态密钥对）
/// 返回 (private_base64, public_base64)；private 落盘 0600、绝不进 API 响应
pub fn generate_noise_keypair() -> Result<(String, String)> {
    use base64::Engine;
    let params: snowstorm::NoiseParams = "Noise_NK_25519_ChaChaPoly_BLAKE2s".parse()?;
    let kp = snowstorm::Builder::new(params).generate_keypair()?;
    Ok((
        base64::engine::general_purpose::STANDARD.encode(&kp.private),
        base64::engine::general_purpose::STANDARD.encode(&kp.public),
    ))
}

/// 由已持久化的 private base64 推导 (private, public)——重启后公钥不变，受控端 pin 不失效
pub fn generate_noise_keypair_from_private(private_b64: &str) -> Result<(String, String)> {
    use base64::Engine;
    let private = base64::engine::general_purpose::STANDARD.decode(private_b64.trim())?;
    // snow::Builder::generate_keypair 永远生成新密钥（snow-0.9.6 builder.rs:153），不能用于恢复；
    // X25519 公钥直接由私钥派生（x25519-dalek），与 rathole NK 模式公钥一致
    let secret: [u8; 32] = private.as_slice().try_into().map_err(|_| anyhow::anyhow!("noise 私钥长度必须为 32 字节"))?;
    let public = x25519_dalek::PublicKey::from(&x25519_dalek::StaticSecret::from(secret));
    Ok((
        base64::engine::general_purpose::STANDARD.encode(&private),
        base64::engine::general_purpose::STANDARD.encode(public.as_bytes()),
    ))
}

/// 依据活跃设备生成 rathole 服务端配置（每个设备一个 service + 独立 token）
/// 显式 noise 传输（D-029：默认 TCP 是明文，绝不依赖默认值）
pub fn render_server_config(registry: &Registry, bind: &str, noise_private_b64: &str) -> String {
    let mut out = String::from("[server]\n");
    out.push_str(&format!("bind_addr = \"{bind}\"\n\n"));
    out.push_str("[server.transport]\ntype = \"noise\"\n");
    out.push_str("[server.transport.noise]\n");
    out.push_str(&format!("local_private_key = \"{noise_private_b64}\"\n\n"));
    for d in registry.active() {
        out.push_str(&format!("[server.services.{}]\n", d.service));
        // SEC-004b：服务端口只绑回环——主控端经 TLS 隧道入口（grant 校验后）转发进来，永不直接暴露公网
        out.push_str(&format!("bind_addr = \"127.0.0.1:{}\"\n", d.port));
        // rathole 服务端配置持有明文 token（服务端即验证方；文件由 persist 以 0600 落盘）
        out.push_str(&format!("token = \"{}\"\n\n", d.rathole_token));
    }
    if registry.active().count() == 0 {
        // rathole 要求 server.services 字段存在（空表合法，热重载会补上注册设备）
        out.push_str("[server.services]\n");
    }
    out
}

/// sidecar 生命周期：spawn → 配置文件重写（rathole notify watcher 自动热重载）
pub struct RatholeSidecar {
    child: Option<Child>,
}

impl RatholeSidecar {
    pub fn new() -> Self {
        Self { child: None }
    }

    pub async fn start(&mut self, bin: &std::path::Path, cfg: &std::path::Path) -> Result<()> {
        if let Some(mut c) = self.child.take() {
            let _ = c.kill().await;
        }
        let child = Command::new(bin)
            .arg("-s") // rathole 服务端模式（其 CLI 具体旗标以所装版本为准，见 M1 测试）
            .arg(cfg)
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .spawn()?;
        self.child = Some(child);
        Ok(())
    }

    /// 设备增删后调用：重写配置触发热重载（rathole 配置 watcher）
    pub fn reload(&self, cfg: &std::path::Path, content: &str) -> Result<()> {
        std::fs::write(cfg, content)?;
        Ok(())
    }

    pub async fn stop(&mut self) {
        if let Some(mut c) = self.child.take() {
            let _ = c.kill().await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 密钥对持久化往返：重启后由 private 推导的 public 必须不变（受控端 pin 不失效）
    #[test]
    fn noise_keypair_roundtrip() {
        let (priv_b64, pub_b64) = generate_noise_keypair().unwrap();
        let (priv2, pub2) = generate_noise_keypair_from_private(&priv_b64).unwrap();
        assert_eq!(priv_b64, priv2);
        assert_eq!(pub_b64, pub2);
        assert_eq!(pub_b64.len(), 44); // 32 字节 X25519 公钥 base64
    }
}
