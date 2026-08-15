// SPEC: docs/security-audit.md#SEC-002 限速与锁定（固定窗口 + 失败锁定，常数时间无关的计数模型）
use std::collections::HashMap;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Attempt {
    Allowed,
    RateLimited,
    Locked,
}

pub struct Limiter {
    /// key -> (窗口起点, 窗口内计数, 锁定截止)
    state: HashMap<String, (Instant, u32, Option<Instant>)>,
    max_per_window: u32,
    window: Duration,
    max_fails: u32,
    lock_for: Duration,
}

impl Limiter {
    pub fn new(max_per_window: u32, window: Duration, max_fails: u32, lock_for: Duration) -> Self {
        Self { state: HashMap::new(), max_per_window, window, max_fails, lock_for }
    }

    pub fn check(&mut self, key: &str) -> Attempt {
        let now = Instant::now();
        let entry = self.state.entry(key.to_string()).or_insert((now, 0, None));
        if let Some(locked_until) = entry.2 {
            if now < locked_until {
                return Attempt::Locked
            }
            entry.2 = None; // 锁过期，重新计数
            entry.1 = 0;
        }
        if now.duration_since(entry.0) >= self.window {
            entry.0 = now;
            entry.1 = 0;
        }
        if entry.1 >= self.max_per_window {
            return Attempt::RateLimited
        }
        entry.1 += 1;
        Attempt::Allowed
    }

    pub fn record_fail(&mut self, key: &str) {
        let now = Instant::now();
        let entry = self.state.entry(key.to_string()).or_insert((now, 0, None));
        entry.1 += 1;
        if entry.1 >= self.max_fails {
            entry.2 = Some(now + self.lock_for);
        }
    }

    pub fn record_success(&mut self, key: &str) {
        self.state.remove(key);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_rate_limit() {
        let mut l = Limiter::new(3, Duration::from_secs(60), 5, Duration::from_secs(300));
        assert_eq!(l.check("k"), Attempt::Allowed);
        assert_eq!(l.check("k"), Attempt::Allowed);
        assert_eq!(l.check("k"), Attempt::Allowed);
        assert_eq!(l.check("k"), Attempt::RateLimited);
    }

    #[test]
    fn fail_lockout() {
        let mut l = Limiter::new(100, Duration::from_secs(60), 2, Duration::from_secs(300));
        l.record_fail("k");
        l.record_fail("k");
        assert_eq!(l.check("k"), Attempt::Locked);
        l.record_success("k");
        assert_eq!(l.check("k"), Attempt::Allowed);
    }
}
