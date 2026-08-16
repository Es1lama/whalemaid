// SPEC: docs/protocol.md#PROTO-003 主控端短期认证会话（15min、绑定客户端 IP + 设备、可重复换 grant）
use std::collections::HashMap;
use std::time::{Duration, Instant};

struct ControllerSession {
    device_id: String,
    client_ip: String,
    expires_at: Instant,
}

pub struct ControllerSessionStore {
    sessions: HashMap<String, ControllerSession>,
    ttl: Duration,
}

impl ControllerSessionStore {
    pub fn new(ttl: Duration) -> Self {
        Self { sessions: HashMap::new(), ttl }
    }

    pub fn issue(&mut self, token: String, device_id: String, client_ip: String) {
        self.prune();
        self.sessions.insert(token, ControllerSession {
            device_id,
            client_ip,
            expires_at: Instant::now() + self.ttl,
        });
    }

    pub fn validate(&mut self, token: &str, device_id: &str, client_ip: &str) -> bool {
        self.prune();
        self.sessions
            .get(token)
            .map(|session| session.device_id == device_id && session.client_ip == client_ip)
            .unwrap_or(false)
    }

    pub fn clear_device(&mut self, device_id: &str) {
        self.sessions.retain(|_, session| session.device_id != device_id);
    }

    fn prune(&mut self) {
        let now = Instant::now();
        self.sessions.retain(|_, session| now <= session.expires_at);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> ControllerSessionStore {
        ControllerSessionStore::new(Duration::from_secs(900))
    }

    #[test]
    fn valid_token_is_reusable() {
        let mut sessions = store();
        sessions.issue("t1".into(), "WHALE-A".into(), "127.0.0.1".into());
        assert!(sessions.validate("t1", "WHALE-A", "127.0.0.1"));
        assert!(sessions.validate("t1", "WHALE-A", "127.0.0.1"));
    }

    #[test]
    fn token_is_bound_to_device_and_ip() {
        let mut sessions = store();
        sessions.issue("t1".into(), "WHALE-A".into(), "127.0.0.1".into());
        assert!(!sessions.validate("t1", "WHALE-B", "127.0.0.1"));
        assert!(!sessions.validate("t1", "WHALE-A", "127.0.0.2"));
        assert!(!sessions.validate("forged", "WHALE-A", "127.0.0.1"));
    }

    #[test]
    fn expired_token_is_rejected() {
        let mut sessions = ControllerSessionStore::new(Duration::ZERO);
        sessions.issue("t1".into(), "WHALE-A".into(), "127.0.0.1".into());
        assert!(!sessions.validate("t1", "WHALE-A", "127.0.0.1"));
    }

    #[test]
    fn clear_device_revokes_only_matching_sessions() {
        let mut sessions = store();
        sessions.issue("t1".into(), "WHALE-A".into(), "127.0.0.1".into());
        sessions.issue("t2".into(), "WHALE-B".into(), "127.0.0.1".into());
        sessions.clear_device("WHALE-A");
        assert!(!sessions.validate("t1", "WHALE-A", "127.0.0.1"));
        assert!(sessions.validate("t2", "WHALE-B", "127.0.0.1"));
    }
}
