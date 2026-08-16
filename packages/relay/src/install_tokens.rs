// SPEC: docs/security-audit.md#SEC-001 可消费安装令牌（审计三轮#4 修订，2026-08-16）
// 安装码不再是无限复用的静态共享秘密：只存 SHA-256 哈希（明文仅在签发时返回一次），
// 每令牌带使用上限（默认 1 次）与可选 TTL；注册成功即消耗；耗尽/过期/未知 → 拒绝。
use anyhow::Result;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallToken {
    pub id: String,
    pub hash: String,
    pub max_uses: u64,
    pub used: u64,
    pub created_at: u64,
    pub expires_at: Option<u64>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct InstallTokenFile {
    tokens: Vec<InstallToken>,
}

pub struct InstallTokenStore {
    path: PathBuf,
    data: InstallTokenFile,
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

fn sha256_hex(s: &str) -> String {
    format!("{:x}", Sha256::digest(s.as_bytes()))
}

impl InstallTokenStore {
    pub fn load(path: PathBuf) -> Result<Self> {
        let data = if path.exists() {
            serde_json::from_str(&std::fs::read_to_string(&path)?)?
        } else {
            InstallTokenFile::default()
        };
        Ok(Self { path, data })
    }

    fn save(&self) -> Result<()> {
        std::fs::write(&self.path, serde_json::to_string_pretty(&self.data)?)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&self.path, std::fs::Permissions::from_mode(0o600))?;
        }
        Ok(())
    }

    /** 签发新令牌，明文仅返回这一次；max_uses=0 视为默认 1 次 */
    pub fn issue(&mut self, max_uses: u64, ttl_sec: Option<u64>) -> Result<String> {
        let token = Uuid::new_v4().simple().to_string();
        self.data.tokens.push(InstallToken {
            id: Uuid::new_v4().simple().to_string(),
            hash: sha256_hex(&token),
            max_uses: if max_uses == 0 { 1 } else { max_uses },
            used: 0,
            created_at: now_secs(),
            expires_at: ttl_sec.map(|t| now_secs() + t),
        });
        self.save()?;
        Ok(token)
    }

    /** 校验并消耗一次；有效返回 true */
    pub fn verify_and_consume(&mut self, code: &str) -> bool {
        let h = sha256_hex(code);
        let now = now_secs();
        let mut ok = false;
        for t in &mut self.data.tokens {
            if t.hash != h {
                continue
            }
            if t.used >= t.max_uses {
                continue
            }
            if let Some(exp) = t.expires_at {
                if now >= exp {
                    continue
                }
            }
            t.used += 1;
            ok = true;
            break;
        }
        if ok {
            let _ = self.save();
        }
        ok
    }

    /** 管理清单（不含明文哈希以外的敏感信息；hash 不回显） */
    pub fn list(&self) -> Vec<serde_json::Value> {
        self.data.tokens.iter().map(|t| serde_json::json!({
            "id": t.id,
            "used": t.used,
            "maxUses": t.max_uses,
            "createdAt": t.created_at,
            "expiresAt": t.expires_at,
        })).collect()
    }

    /** 首启种子：ADMIN_INSTALL_CODE 环境变量（默认单次）；已存在同哈希则跳过（幂等） */
    pub fn seed_if_new(&mut self, env_code: &str) -> Result<()> {
        if env_code.is_empty() {
            return Ok(())
        }
        let h = sha256_hex(env_code);
        if self.data.tokens.iter().any(|t| t.hash == h) {
            return Ok(())
        }
        self.data.tokens.push(InstallToken {
            id: Uuid::new_v4().simple().to_string(),
            hash: h,
            max_uses: 1,
            used: 0,
            created_at: now_secs(),
            expires_at: None,
        });
        self.save()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> InstallTokenStore {
        InstallTokenStore::load(PathBuf::from(format!("/tmp/whalemaid-install-tokens-{}.json", Uuid::new_v4().simple()))).unwrap()
    }

    /// 攻击路径（SEC-001）：令牌默认单次——第二次注册同码必须被拒
    #[test]
    fn token_single_use_by_default() {
        let mut s = store();
        let t = s.issue(0, None).unwrap();
        assert!(s.verify_and_consume(&t));
        assert!(!s.verify_and_consume(&t));
    }

    /// 未知令牌拒绝；哈希不落明文
    #[test]
    fn unknown_token_rejected_and_no_plaintext_stored() {
        let mut s = store();
        let t = s.issue(0, None).unwrap();
        assert!(!s.verify_and_consume("wrong-code"));
        let raw = std::fs::read_to_string(&s.path).unwrap();
        assert!(!raw.contains(&t));
    }

    /// max_uses 上限：耗尽即拒
    #[test]
    fn max_uses_cap() {
        let mut s = store();
        let t = s.issue(3, None).unwrap();
        assert!(s.verify_and_consume(&t));
        assert!(s.verify_and_consume(&t));
        assert!(s.verify_and_consume(&t));
        assert!(!s.verify_and_consume(&t));
    }

    /// TTL 过期拒绝（ttl=0 视为立即过期）
    #[test]
    fn expired_token_rejected() {
        let mut s = store();
        let t = s.issue(1, Some(0)).unwrap();
        assert!(!s.verify_and_consume(&t));
    }

    /// 首启种子幂等：同码不重复入库
    #[test]
    fn seed_idempotent() {
        let mut s = store();
        s.seed_if_new("seed-code").unwrap();
        s.seed_if_new("seed-code").unwrap();
        assert_eq!(s.data.tokens.len(), 1);
        assert!(s.verify_and_consume("seed-code"));
    }
}
