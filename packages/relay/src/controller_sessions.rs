// SPEC: docs/protocol.md#PROTO-003 主控端短期认证会话（15min、绑定客户端 IP + 设备、可重复换 grant）
use std::collections::HashMap;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CredentialKind {
    LongTerm,
    Temporary,
}

struct ControllerSession {
    device_id: String,
    client_ip: String,
    expires_at: Instant,
    credential_kind: CredentialKind,
    temporary_generation: Option<u64>,
}

pub struct ControllerSessionStore {
    sessions: HashMap<String, ControllerSession>,
    ttl: Duration,
}

impl ControllerSessionStore {
    pub fn new(ttl: Duration) -> Self {
        Self { sessions: HashMap::new(), ttl }
    }

    #[cfg(test)]
    pub fn issue(&mut self, token: String, device_id: String, client_ip: String) {
        self.issue_with_ttl(token, device_id, client_ip, CredentialKind::LongTerm, self.ttl, None);
    }

    pub fn issue_with_ttl(
        &mut self,
        token: String,
        device_id: String,
        client_ip: String,
        credential_kind: CredentialKind,
        ttl: Duration,
        temporary_generation: Option<u64>,
    ) {
        self.prune();
        self.sessions.insert(token, ControllerSession {
            device_id,
            client_ip,
            expires_at: Instant::now() + ttl.min(self.ttl),
            credential_kind,
            temporary_generation,
        });
    }

    pub fn validate_session(&mut self, token: &str, device_id: &str, client_ip: &str) -> Option<(CredentialKind, u64, Option<u64>)> {
        self.prune();
        self.sessions
            .get(token)
            .filter(|session| session.device_id == device_id && session.client_ip == client_ip)
            .map(|session| {
                let remaining = session.expires_at.saturating_duration_since(Instant::now()).as_secs().max(1);
                (session.credential_kind, remaining, session.temporary_generation)
            })
    }

    #[cfg(test)]
    pub fn validate_kind(&mut self, token: &str, device_id: &str, client_ip: &str) -> Option<CredentialKind> {
        self.validate_session(token, device_id, client_ip).map(|(kind, _, _)| kind)
    }

    #[cfg(test)]
    pub fn validate(&mut self, token: &str, device_id: &str, client_ip: &str) -> bool {
        self.validate_session(token, device_id, client_ip).is_some()
    }

    pub fn clear_device(&mut self, device_id: &str) {
        self.sessions.retain(|_, session| session.device_id != device_id);
    }

    pub fn clear_temporary_device(&mut self, device_id: &str) {
        self.sessions.retain(|_, session| {
            session.device_id != device_id || session.credential_kind != CredentialKind::Temporary
        });
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
    fn temporary_session_keeps_kind_and_uses_bounded_ttl() {
        let mut sessions = store();
        sessions.issue_with_ttl(
            "temp".into(),
            "WHALE-A".into(),
            "127.0.0.1".into(),
            CredentialKind::Temporary,
            Duration::from_secs(60),
            Some(1),
        );
        assert_eq!(
            sessions.validate_kind("temp", "WHALE-A", "127.0.0.1"),
            Some(CredentialKind::Temporary),
        );
    }

    #[test]
    fn clearing_temporary_sessions_preserves_long_term_sessions() {
        let mut sessions = store();
        sessions.issue("long".into(), "WHALE-A".into(), "127.0.0.1".into());
        sessions.issue_with_ttl(
            "temp".into(),
            "WHALE-A".into(),
            "127.0.0.1".into(),
            CredentialKind::Temporary,
            Duration::from_secs(60),
            Some(1),
        );
        sessions.clear_temporary_device("WHALE-A");
        assert!(sessions.validate("long", "WHALE-A", "127.0.0.1"));
        assert!(!sessions.validate("temp", "WHALE-A", "127.0.0.1"));
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
