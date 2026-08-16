// SPEC: docs/threat-model.md#TM-005/011 设备注册表（吊销即时生效；只记元数据）
// SPEC: docs/security-audit.md#SEC-001/002/003 每设备独立凭据、argon2 密码哈希、隧道 token 轮换
// SPEC: docs/adr/INDEX.md#ADR-032 每设备 = rathole 一个 service + token
use anyhow::Result;
use scrypt::password_hash::PasswordHash;
#[cfg(test)]
use scrypt::password_hash::{PasswordHasher, SaltString};
use scrypt::password_hash::PasswordVerifier;
use scrypt::Scrypt;
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

/// SEC-002：scrypt 加盐慢哈希（PHC 字符串；参数显式 ln=14,r=8,p=1，Node 端 crypto.scryptSync(N=16384) 可生成同格式）
/// 生产路径不哈希明文密码（受控端注册时只上传密码哈希；主控端 /connect 只做 verify）——仅测试用
#[cfg(test)]
pub fn hash_password(password: &str) -> Result<String> {
    let mut salt_bytes = [0u8; 16];
    getrandom::getrandom(&mut salt_bytes).map_err(|e| anyhow::anyhow!("{e}"))?;
    let salt = SaltString::encode_b64(&salt_bytes).map_err(|e| anyhow::anyhow!("{e}"))?;
    let params = scrypt::Params::new(14, 8, 1, 32).map_err(|e| anyhow::anyhow!("{e}"))?;
    Ok(Scrypt
        .hash_password_customized(password.as_bytes(), None, None, params, &salt)
        .map_err(|e| anyhow::anyhow!("{e}"))?
        .to_string())
}

pub fn verify_password(password: &str, digest_str: &str) -> bool {
    PasswordHash::new(digest_str)
        .map(|h| Scrypt.verify_password(password.as_bytes(), &h).is_ok())
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

    /// SEC-002：测试辅助；生产 /connect 在 blocking 池校验 scrypt，避免阻塞异步执行器。
    #[cfg(test)]
    pub fn verify_device_password(&self, device_id: &str, password: &str) -> Option<&DeviceRecord> {
        let dev = self.devices.iter().find(|d| d.id == device_id && !d.revoked)?;
        if verify_password(password, &dev.password_digest) {
            Some(dev)
        } else {
            None
        }
    }

    /// 密码轮换：凭据鉴权后原子替换 PHC（审计三轮#3——旧哈希立即失效）
    pub fn update_password(&mut self, device_id: &str, new_password_digest: &str) -> bool {
        let Some(dev) = self.devices.iter_mut().find(|d| d.id == device_id && !d.revoked) else {
            return false;
        };
        dev.password_digest = new_password_digest.to_string();
        let _ = self.persist();
        true
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

    /// 最近心跳时间（unix 秒）；设备状态查询用（audit#4：主控端按编号查在线状态）
    pub fn last_seen_at(&self, id: &str) -> Option<u64> {
        self.last_seen.get(id).copied()
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

    /// 跨语言一致性（SEC-002）：Node crypto.scryptSync(N=16384,r=8,p=1) 生成的 PHC 必须可验
    #[test]
    fn node_generated_phc_verifies() {
        const NODE_PHC: &str = "$scrypt$ln=14,r=8,p=1$ASNFZ4mrze8BI0VniavN7w$5q49mzIigOxUr3OifkYPVkYBA/AkPMXgzQXNg+vWlLpmToAxmQQ4sT3VKMdSL3iUXO6ICEMbNMHRyKNB63QUHQ";
        assert!(verify_password("pw123", NODE_PHC));
        assert!(!verify_password("wrong", NODE_PHC));
    }

    /// SEC-003（Codex 审计修复）：隧道 token 注册后固定——授权不靠 token 轮换，主控端在网关侧认证
    #[test]
    fn tunnel_token_stable_after_register() {
        let mut reg = temp_registry();
        let (rec, _, issued) = reg.register("whale-test-cccc", &hash_password("pw").unwrap()).unwrap();
        // 再取一次（等价于心跳/连接后的状态）仍为同一 token
        let again = reg.active().find(|d| d.id == rec.id).unwrap().rathole_token.clone();
        assert_eq!(issued, again);
        assert_eq!(reg.active().next().unwrap().rathole_token, issued);
    }

    #[test]
    fn duplicate_registration_rejected() {
        let mut reg = temp_registry();
        reg.register("whale-test-dddd", &hash_password("pw").unwrap()).unwrap();
        assert!(reg.register("whale-test-dddd", &hash_password("pw").unwrap()).is_err());
    }

    /// 密码轮换（审计三轮#3）：旧密码立即失效、新密码可验、未知设备失败
    #[test]
    fn password_rotation_replaces_digest() {
        let mut reg = temp_registry();
        let (rec, _, _) = reg.register("whale-test-pppp", &hash_password("old-pw").unwrap()).unwrap();
        assert!(reg.verify_device_password("whale-test-pppp", "old-pw").is_some());
        assert!(reg.update_password(&rec.id, &hash_password("new-pw").unwrap()));
        assert!(reg.verify_device_password("whale-test-pppp", "old-pw").is_none()); // 旧密码立即失效
        assert!(reg.verify_device_password("whale-test-pppp", "new-pw").is_some());
        assert!(!reg.update_password("ghost", &hash_password("x").unwrap()));
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
        assert_eq!(reg.last_seen_at(&record.id), None);
        assert!(reg.touch(&record.id));
        assert!(reg.online(&record.id, 45));
        assert!(reg.last_seen_at(&record.id).is_some());
        assert_eq!(reg.last_seen_at("ghost"), None);
        assert!(!reg.touch("unknown-id"));
    }
}
