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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum TemporaryCredentialState {
    #[default]
    None,
    Active,
    Consumed,
    Revoked,
    Expired,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct TemporaryPasswordRecord {
    #[serde(default)]
    pub digest: String,
    #[serde(default)]
    pub expires_at: u64,
    #[serde(default)]
    pub generation: u64,
    #[serde(default)]
    pub state: TemporaryCredentialState,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TemporaryPasswordCandidate {
    pub digest: String,
    pub expires_at: u64,
    pub generation: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TemporaryPasswordIssued {
    pub expires_at: u64,
    pub generation: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TemporaryCredentialError {
    UnknownDevice,
    NotConfigured,
    Expired,
    Consumed,
    Revoked,
    Superseded,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceRecord {
    pub id: String,
    /// 每设备控制面凭据摘要（SEC-001：不存明文）
    pub credential_digest: String,
    /// 设备长期密码 scrypt PHC（SEC-002：加盐慢哈希）
    pub password_digest: String,
    /// rathole 握手所需明文 token——rathole 服务端模型要求配置持有明文（服务端即验证方，本文件即服务端秘密存储，mode 0600）
    pub rathole_token: String,
    /// rathole service 名（= 设备 id）
    pub service: String,
    /// 分配的转发端口
    pub port: u16,
    pub revoked: bool,
    pub created_at: u64,
    /// 主控端成功授权次数（心跳带走清零；UX-009 受控端知情提示；内存态不落盘）
    #[serde(default)]
    pub connect_events: u64,
    /** REQ-003：只保存临时密码 PHC、服务端到期时间与单调 generation；明文永不进入中继。 */
    #[serde(default)]
    pub temporary_password: TemporaryPasswordRecord,
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
            connect_events: 0,
            temporary_password: TemporaryPasswordRecord::default(),
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

    /** REQ-003：以中继时钟签发/刷新一次性临时密码，generation 阻断并发旧验证结果。 */
    pub fn issue_temporary_password(
        &mut self,
        device_id: &str,
        digest: &str,
        ttl_secs: u64,
        now: u64,
    ) -> Result<TemporaryPasswordIssued> {
        let dev = self
            .devices
            .iter_mut()
            .find(|d| d.id == device_id && !d.revoked)
            .ok_or_else(|| anyhow::anyhow!("unknown-device"))?;
        let generation = dev.temporary_password.generation.saturating_add(1);
        let expires_at = now.saturating_add(ttl_secs);
        dev.temporary_password = TemporaryPasswordRecord {
            digest: digest.to_string(),
            expires_at,
            generation,
            state: TemporaryCredentialState::Active,
        };
        self.persist()?;
        Ok(TemporaryPasswordIssued { expires_at, generation })
    }

    /** 复制待验证 PHC 后立即释放 registry 锁；最终消费必须再次校验 generation。 */
    pub fn temporary_password_candidate(
        &mut self,
        device_id: &str,
        now: u64,
    ) -> std::result::Result<TemporaryPasswordCandidate, TemporaryCredentialError> {
        let mut expired = false;
        let result = {
            let dev = self
                .devices
                .iter_mut()
                .find(|d| d.id == device_id && !d.revoked)
                .ok_or(TemporaryCredentialError::UnknownDevice)?;
            if dev.temporary_password.state == TemporaryCredentialState::Active
                && now > dev.temporary_password.expires_at
            {
                dev.temporary_password.state = TemporaryCredentialState::Expired;
                dev.temporary_password.digest.clear();
                expired = true;
            }
            match dev.temporary_password.state {
                TemporaryCredentialState::Active => Ok(TemporaryPasswordCandidate {
                    digest: dev.temporary_password.digest.clone(),
                    expires_at: dev.temporary_password.expires_at,
                    generation: dev.temporary_password.generation,
                }),
                TemporaryCredentialState::None => Err(TemporaryCredentialError::NotConfigured),
                TemporaryCredentialState::Expired => Err(TemporaryCredentialError::Expired),
                TemporaryCredentialState::Consumed => Err(TemporaryCredentialError::Consumed),
                TemporaryCredentialState::Revoked => Err(TemporaryCredentialError::Revoked),
            }
        };
        if expired {
            let _ = self.persist();
        }
        result
    }

    /** 慢哈希验证成功后的原子提交点：只有仍为同一 active generation 才能消费。 */
    pub fn consume_temporary_password(
        &mut self,
        device_id: &str,
        generation: u64,
        now: u64,
    ) -> std::result::Result<(), TemporaryCredentialError> {
        let candidate = self.temporary_password_candidate(device_id, now)?;
        if candidate.generation != generation {
            return Err(TemporaryCredentialError::Superseded)
        }
        let dev = self
            .devices
            .iter_mut()
            .find(|d| d.id == device_id && !d.revoked)
            .ok_or(TemporaryCredentialError::UnknownDevice)?;
        if dev.temporary_password.state != TemporaryCredentialState::Active
            || dev.temporary_password.generation != generation
        {
            return Err(TemporaryCredentialError::Superseded)
        }
        dev.temporary_password.state = TemporaryCredentialState::Consumed;
        dev.temporary_password.digest.clear();
        let _ = self.persist();
        Ok(())
    }

    pub fn revoke_temporary_password(&mut self, device_id: &str) -> bool {
        let Some(dev) = self.devices.iter_mut().find(|d| d.id == device_id && !d.revoked) else {
            return false;
        };
        if dev.temporary_password.state != TemporaryCredentialState::Active {
            return false;
        }
        dev.temporary_password.state = TemporaryCredentialState::Revoked;
        dev.temporary_password.digest.clear();
        let _ = self.persist();
        true
    }

    pub fn temporary_password_status(
        &mut self,
        device_id: &str,
        now: u64,
    ) -> std::result::Result<TemporaryPasswordRecord, TemporaryCredentialError> {
        let _ = self.temporary_password_candidate(device_id, now);
        self.devices
            .iter()
            .find(|d| d.id == device_id && !d.revoked)
            .map(|d| d.temporary_password.clone())
            .ok_or(TemporaryCredentialError::UnknownDevice)
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
    /// 主控端成功授权计数（心跳带走并清零，UX-009 受控端知情提示用）
    pub fn take_connect_events(&mut self, id: &str) -> u64 {
        let n = self.devices.iter().find(|d| d.id == id).map(|d| d.connect_events).unwrap_or(0);
        if let Some(d) = self.devices.iter_mut().find(|d| d.id == id) { d.connect_events = 0; }
        n
    }

    pub fn note_connect(&mut self, id: &str) {
        if let Some(d) = self.devices.iter_mut().find(|d| d.id == id) { d.connect_events += 1; }
    }

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
    fn temporary_password_is_consumed_once() {
        let mut reg = temp_registry();
        let (rec, _, _) = reg.register("whale-test-temp", &hash_password("long-pw").unwrap()).unwrap();
        let digest = hash_password("WMT-ABCD-EFGH").unwrap();
        let issued = reg.issue_temporary_password(&rec.id, &digest, 600, 1_000).unwrap();
        assert_eq!(issued.expires_at, 1_600);

        let candidate = reg.temporary_password_candidate(&rec.id, 1_100).unwrap();
        assert_eq!(candidate.digest, digest);
        assert!(reg.consume_temporary_password(&rec.id, candidate.generation, 1_100).is_ok());
        assert_eq!(
            reg.temporary_password_candidate(&rec.id, 1_100),
            Err(TemporaryCredentialError::Consumed),
        );
    }

    #[test]
    fn temporary_password_generation_blocks_stale_verification() {
        let mut reg = temp_registry();
        let (rec, _, _) = reg.register("whale-test-refresh", &hash_password("long-pw").unwrap()).unwrap();
        reg.issue_temporary_password(&rec.id, &hash_password("WMT-OLD1-OLD2").unwrap(), 600, 1_000).unwrap();
        let stale = reg.temporary_password_candidate(&rec.id, 1_010).unwrap();
        let current = reg.issue_temporary_password(&rec.id, &hash_password("WMT-NEW1-NEW2").unwrap(), 600, 1_020).unwrap();

        assert_eq!(
            reg.consume_temporary_password(&rec.id, stale.generation, 1_030),
            Err(TemporaryCredentialError::Superseded),
        );
        assert!(reg.consume_temporary_password(&rec.id, current.generation, 1_030).is_ok());
    }

    #[test]
    fn temporary_password_expiry_revoke_and_persistence_are_distinct() {
        let dir = std::env::temp_dir().join(format!("whalemaid-relay-temp-state-{}", Uuid::new_v4()));
        let file = dir.join("devices.json");
        let mut reg = Registry::load(file.clone(), 5202).unwrap();
        let (rec, _, _) = reg.register("whale-test-states", &hash_password("long-pw").unwrap()).unwrap();
        reg.issue_temporary_password(&rec.id, &hash_password("WMT-TIME-OUT1").unwrap(), 60, 1_000).unwrap();
        assert_eq!(
            reg.temporary_password_candidate(&rec.id, 1_061),
            Err(TemporaryCredentialError::Expired),
        );

        reg.issue_temporary_password(&rec.id, &hash_password("WMT-REVO-KED1").unwrap(), 60, 2_000).unwrap();
        assert!(reg.revoke_temporary_password(&rec.id));
        drop(reg);

        let mut reloaded = Registry::load(file, 5202).unwrap();
        assert_eq!(
            reloaded.temporary_password_candidate(&rec.id, 2_010),
            Err(TemporaryCredentialError::Revoked),
        );
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
