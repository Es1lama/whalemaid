// SPEC: docs/adr/INDEX.md#ADR-032 rathole sidecar：写配置→热重载（notify watcher）→增删设备即生效
use crate::registry::Registry;
use anyhow::Result;
use std::process::Stdio;
use tokio::process::{Child, Command};

/// 依据活跃设备生成 rathole 服务端配置（每个设备一个 service + 独立 token）
pub fn render_server_config(registry: &Registry, bind: &str) -> String {
    let mut out = String::from("[server]\n");
    out.push_str(&format!("bind_addr = \"{bind}\"\n\n"));
    for d in registry.active() {
        out.push_str(&format!("[server.services.{}]\n", d.service));
        out.push_str(&format!("bind_addr = \"0.0.0.0:{}\"\n", d.port));
        // rathole 服务端配置持有明文 token（服务端即验证方；文件由 persist 以 0600 落盘）
        out.push_str(&format!("token = \"{}\"\n\n", d.rathole_token));
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
