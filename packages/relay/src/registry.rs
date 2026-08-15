// SPEC: docs/threat-model.md#TM-005/011 设备注册表（吊销即时生效；只记元数据）
// SPEC: docs/security-audit.md#SEC-001/002/003 每设备独立凭据、argon2 密码哈希、隧道 token 轮换
// SPEC: docs/adr/INDEX.md#ADR-032 每设备 = rathole 一个 service + token
use anyhow::Result;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceRecord {
    pub id: String,
    /// 每设备控制面凭据摘要（SEC-001：不存明文）
    pub credential_digest: String,
    /// 设备密码 argon2 哈希（SEC-002：加盐慢哈希）
    pub password_digest: String,
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
    /** 心跳时间戳（内存态，不落盘：在线状态是读时计算的瞬态） */
    last_seen: std::collections::HashMap<String, u64>,
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

pub fn hash_password(password: &str) -> Result<String> {
    let mut salt_bytes = [0u8; 16];
    getrandom::getrandom(&mut salt_bytes).map_err(|e| anyhow::anyhow!("{e}"))?;
    let salt = SaltString::encode_b64(&salt_bytes).map_err(|e| anyhow::anyhow!("{e}"))?;
    Ok(Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| anyhow::anyhow!("{e}"))?
        .to_string())
}

pub fn verify_password(password: &str, digest_str: &str) -> bool {
    PasswordHash::new(digest_str)
        .map(|h| Argon2::default().verify_password(password.as_bytes(), &h).is_ok())
        .unwrap_or(false)
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
        Ok(Self { file, devices, next_port, last_seen: std::collections::HashMap::new() })
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

    /// 注册新设备（SEC-001/002/003）：设备编号 + 密码哈希入册，签发每设备凭据与初始隧道 token（均只回明文一次）
    pub fn register(&mut self, device_id: &str, password_digest: &str) -> Result<(DeviceRecord, String, String)> {
        if self.devices.iter().any(|d| d.id == device_id && !d.revoked) {
            anyhow::bail!("device-already-registered")
        }
        let credential = Uuid::new_v4().simple().to_string();
        let tunnel_token = Uuid::new_v4().simple().to_string();
        let record = DeviceRecord {
            id: device_id.to_string(),
            credential_digest: digest(&credential),
            password_digest: password_digest.to_string(),
            rathole_token: tunnel_token.clone(),
            service: device_id.to_string(),
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
        Ok((record, credential, tunnel_token))
    }

    /// SEC-001：每设备凭据鉴权（心跳/吊销用）
    pub fn authenticate_credential(&self, credential: &str) -> Option<&DeviceRecord> {
        let d = digest(credential);
        self.devices.iter().find(|x| x.credential_digest == d && !x.revoked)
    }

    /// SEC-002：/connect 密码校验（argon2 常数时间验证）
    pub fn verify_device_password(&self, device_id: &str, password: &str) -> Option<&DeviceRecord> {
        let dev = self.devices.iter().find(|d| d.id == device_id && !d.revoked)?;
        if verify_password(password, &dev.password_digest) {
            Some(dev)
        } else {
            None
        }
    }

    /// SEC-003：隧道 token 一次性轮换（旧 token 随配置热重载即时失效）
    pub fn rotate_tunnel_token(&mut self, device_id: &str) -> Result<Option<String>> {
        let Some(dev) = self.devices.iter_mut().find(|d| d.id == device_id && !d.revoked) else {
            return Ok(None)
        };
        let token = Uuid::new_v4().simple().to_string();
        dev.rathole_token = token.clone();
        self.persist()?;
        Ok(Some(token))
    }

    pub fn active(&self) -> impl Iterator<Item = &DeviceRecord> {
        self.devices.iter().filter(|d| !d.revoked)
    }

    pub fn revoke(&mut self, id: &str) -> bool {
        let Some(d) = self.devices.iter_mut().find(|d| d.id == id && !d.revoked) else {
            return false;
        };
        d.revoked = true;
        let _ = self.persist();
        true
    }

    /// 心跳：更新内存时间戳；返回该设备是否已知且未吊销
    pub fn touch(&mut self, id: &str) -> bool {
        let known = self.devices.iter().any(|d| d.id == id && !d.revoked);
        if known {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            self.last_seen.insert(id.to_string(), now);
        }
        known
    }

    /// 在线判定：最近一次心跳在超时窗口内
    pub fn online(&self, id: &str, timeout_secs: u64) -> bool {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        self.last_seen
            .get(id)
            .map(|t| now.saturating_sub(*t) <= timeout_secs)
            .unwrap_or(false)
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
        let (record, credential, token) = reg.register("whale-test-aaaa", &hash_password("pw").unwrap()).unwrap();
        assert_eq!(record.credential_digest, digest(&credential));
        assert_eq!(record.rathole_token, token);
        assert!(reg.authenticate_credential(&credential).is_some());
        assert!(reg.revoke(&record.id));
        assert!(reg.authenticate_credential(&credential).is_none());
    }

    #[test]
    fn password_matching() {
        let mut reg = temp_registry();
        reg.register("whale-test-bbbb", &hash_password("correct").unwrap()).unwrap();
        assert!(reg.verify_device_password("whale-test-bbbb", "correct").is_some());
        assert!(reg.verify_device_password("whale-test-bbbb", "wrong").is_none());
        assert!(reg.verify_device_password("ghost", "correct").is_none());
    }

    #[test]
    fn tunnel_token_rotation() {
        let mut reg = temp_registry();
        let (rec, _, old) = reg.register("whale-test-cccc", &hash_password("pw").unwrap()).unwrap();
        let new = reg.rotate_tunnel_token(&rec.id).unwrap().unwrap();
        assert_ne!(old, new);
        assert_eq!(reg.active().next().unwrap().rathole_token, new);
    }

    #[test]
    fn duplicate_registration_rejected() {
        let mut reg = temp_registry();
        reg.register("whale-test-dddd", &hash_password("pw").unwrap()).unwrap();
        assert!(reg.register("whale-test-dddd", &hash_password("pw").unwrap()).is_err());
    }

    #[test]
    fn ports_are_distinct() {
        let mut reg = temp_registry();
        let (a, _, _) = reg.register("whale-test-eeee", &hash_password("pw").unwrap()).unwrap();
        let (b, _, _) = reg.register("whale-test-ffff", &hash_password("pw").unwrap()).unwrap();
        assert_ne!(a.port, b.port);
    }

    #[test]
    fn heartbeat_and_online() {
        let mut reg = temp_registry();
        let (record, _, _) = reg.register("whale-test-gggg", &hash_password("pw").unwrap()).unwrap();
        assert!(!reg.online(&record.id, 45));
        assert!(reg.touch(&record.id));
        assert!(reg.online(&record.id, 45));
        assert!(!reg.touch("unknown-id"));
    }
}
