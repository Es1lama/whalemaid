// SPEC: docs/threat-model.md#TM-005/011 设备注册表（吊销即时生效；只记元数据）
// SPEC: docs/adr/INDEX.md#ADR-032 每设备 = rathole 一个 service + token
use anyhow::Result;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceRecord {
    pub id: String,
    /// 控制面校验用摘要（TM-003）
    pub token_digest: String,
    /// rathole 握手所需明文 token——rathole 服务端模型要求配置持有明文（服务端即验证方，本文件即服务端秘密存储，mode 0600）
    pub rathole_token: String,
    /// rathole service 名（= 设备 id）
    pub service: String,
    /// 分配的转发端口
    pub port: u16,
    pub revoked: bool,
    pub created_at: u64,
}

pub struct Registry {
    file: PathBuf,
    devices: Vec<DeviceRecord>,
    next_port: u16,
}

pub fn digest(value: &str) -> String {
    let mut h = Sha256::new();
    h.update(value.as_bytes());
    hex::encode(h.finalize())
}

// 避免额外依赖，本地 hex
mod hex {
    pub fn encode(bytes: impl AsRef<[u8]>) -> String {
        bytes.as_ref().iter().map(|b| format!("{b:02x}")).collect()
    }
}

impl Registry {
    pub fn load(file: PathBuf, port_base: u16) -> Result<Self> {
        let devices: Vec<DeviceRecord> = if file.exists() {
            serde_json::from_str(&fs::read_to_string(&file)?)?
        } else {
            Vec::new()
        };
        let next_port = devices
            .iter()
            .map(|d| d.port)
            .max()
            .map(|p| p + 1)
            .unwrap_or(port_base);
        Ok(Self { file, devices, next_port })
    }

    fn persist(&self) -> Result<()> {
        fs::create_dir_all(self.file.parent().unwrap())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::write(&self.file, serde_json::to_string_pretty(&self.devices)?)?;
            fs::set_permissions(&self.file, fs::Permissions::from_mode(0o600))?;
        }
        #[cfg(not(unix))]
        fs::write(&self.file, serde_json::to_string_pretty(&self.devices)?)?;
        Ok(())
    }

    /// 注册新设备：分配 service 名与端口，返回明文 token（仅此一次可见）
    pub fn register(&mut self) -> Result<(DeviceRecord, String)> {
        let id = format!("whale-{}", Uuid::new_v4().simple().to_string()[..8].to_uppercase());
        let token = Uuid::new_v4().simple().to_string();
        let record = DeviceRecord {
            id: id.clone(),
            token_digest: digest(&token),
            rathole_token: token.clone(),
            service: id.clone(),
            port: self.next_port,
            revoked: false,
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0),
        };
        self.next_port += 1;
        self.devices.push(record.clone());
        self.persist()?;
        Ok((record, token))
    }

    /// 吊销：置位即可，rathole 配置重写后该 service 消失，连接即断（TM-005）
    pub fn revoke(&mut self, id: &str) -> bool {
        let Some(d) = self.devices.iter_mut().find(|d| d.id == id && !d.revoked) else {
            return false;
        };
        d.revoked = true;
        let _ = self.persist();
        true
    }

    pub fn active(&self) -> impl Iterator<Item = &DeviceRecord> {
        self.devices.iter().filter(|d| !d.revoked)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_registry() -> Registry {
        let dir = std::env::temp_dir().join(format!("whalemaid-relay-test-{}", Uuid::new_v4()));
        Registry::load(dir.join("devices.json"), 5202).unwrap()
    }

    #[test]
    fn register_and_revoke() {
        let mut reg = temp_registry();
        let (record, token) = reg.register().unwrap();
        assert_eq!(record.token_digest, digest(&token));
        assert!(reg.active().any(|d| d.id == record.id));
        assert!(reg.revoke(&record.id));
        assert!(!reg.active().any(|d| d.id == record.id));
        assert!(!reg.revoke(&record.id), "重复吊销返回 false");
    }

    #[test]
    fn ports_are_distinct() {
        let mut reg = temp_registry();
        let (a, _) = reg.register().unwrap();
        let (b, _) = reg.register().unwrap();
        assert_ne!(a.port, b.port);
    }
}
