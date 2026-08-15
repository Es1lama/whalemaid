// SPEC: docs/security-audit.md#SEC-004b 主控端→中继段一次性 grant（TTL 2min、单次消费、绑定设备）
// 攻击路径单测：重用失败 / 过期失败 / 伪造失败 / 跨设备混用失败
use std::collections::HashMap;
use std::time::{Duration, Instant};

pub struct Grant {
    pub device_id: String,
    pub service_port: u16,
    pub expires_at: Instant,
}

pub struct GrantStore {
    grants: HashMap<String, Grant>,
    ttl: Duration,
}

impl GrantStore {
    pub fn new(ttl: Duration) -> Self {
        Self { grants: HashMap::new(), ttl }
    }

    /// 签发一次性 grant（绑定设备与其 rathole 服务端口）；顺带清理过期条目
    pub fn issue(&mut self, token: String, device_id: String, service_port: u16) {
        self.prune();
        self.grants.insert(token, Grant { device_id, service_port, expires_at: Instant::now() + self.ttl });
    }

    /// 消费 grant：存在性 + TTL + 设备一致，命中即删除（单次消费）；返回目标设备服务端口
    pub fn consume(&mut self, token: &str, device_id: &str) -> Option<u16> {
        let g = self.grants.remove(token)?;
        if Instant::now() > g.expires_at {
            return None;
        }
        if g.device_id != device_id {
            return None;
        }
        Some(g.service_port)
    }

    /// 过期清理（防内存增长）
    pub fn prune(&mut self) {
        let now = Instant::now();
        self.grants.retain(|_, g| now <= g.expires_at);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> GrantStore {
        GrantStore::new(Duration::from_secs(120))
    }

    #[test]
    fn single_use_only() {
        let mut s = store();
        s.issue("t1".into(), "WHALE-TEST-0001".into(), 5202);
        assert_eq!(s.consume("t1", "WHALE-TEST-0001"), Some(5202));
        // 攻击路径：重用同一 grant 必须失败
        assert_eq!(s.consume("t1", "WHALE-TEST-0001"), None);
    }

    #[test]
    fn forged_token_rejected() {
        let mut s = store();
        assert_eq!(s.consume("forged", "WHALE-TEST-0001"), None);
    }

    #[test]
    fn expired_token_rejected() {
        let mut s = GrantStore::new(Duration::ZERO);
        s.issue("t1".into(), "WHALE-TEST-0001".into(), 5202);
        assert_eq!(s.consume("t1", "WHALE-TEST-0001"), None);
    }

    #[test]
    fn device_binding_enforced() {
        let mut s = store();
        s.issue("t1".into(), "WHALE-TEST-0001".into(), 5202);
        // 攻击路径：拿设备 A 的 grant 连设备 B 必须失败
        assert_eq!(s.consume("t1", "WHALE-TEST-0002"), None);
    }

    #[test]
    fn prune_removes_expired() {
        let mut s = GrantStore::new(Duration::ZERO);
        s.issue("t1".into(), "WHALE-TEST-0001".into(), 5202);
        s.prune();
        assert_eq!(s.consume("t1", "WHALE-TEST-0001"), None);
    }
}
