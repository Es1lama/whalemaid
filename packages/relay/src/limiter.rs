// SPEC: docs/security-audit.md#SEC-002 限速与锁定（固定窗口 + 失败锁定；窗口计数与失败计数分离）
use std::collections::HashMap;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Attempt {
    Allowed,
    RateLimited,
    Locked,
}

#[derive(Debug)]
struct Entry {
    window_start: Instant,
    window_count: u32,
    fail_count: u32,
    locked_until: Option<Instant>,
}

pub struct Limiter {
    /// key -> 状态（窗口计数与失败计数分离：失败不占限速预算，成功清零失败历史）
    state: HashMap<String, Entry>,
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
        let entry = self.state.entry(key.to_string()).or_insert(Entry {
            window_start: now,
            window_count: 0,
            fail_count: 0,
            locked_until: None,
        });
        if let Some(locked_until) = entry.locked_until {
            if now < locked_until {
                return Attempt::Locked
            }
            entry.locked_until = None; // 锁过期，重新计数
            entry.fail_count = 0;
        }
        if now.duration_since(entry.window_start) >= self.window {
            entry.window_start = now;
            entry.window_count = 0;
        }
        if entry.window_count >= self.max_per_window {
            return Attempt::RateLimited
        }
        entry.window_count += 1;
        Attempt::Allowed
    }

    pub fn record_fail(&mut self, key: &str) {
        let now = Instant::now();
        let entry = self.state.entry(key.to_string()).or_insert(Entry {
            window_start: now,
            window_count: 0,
            fail_count: 0,
            locked_until: None,
        });
        entry.fail_count += 1;
        if entry.fail_count >= self.max_fails {
            entry.locked_until = Some(now + self.lock_for);
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

    /// 攻击路径（SEC-002）：连续错误达到 max_fails 即锁定，锁定期内即使密码正确也拒绝
    #[test]
    fn lockout_denies_correct_password_during_lock() {
        let mut l = Limiter::new(100, Duration::from_secs(60), 5, Duration::from_secs(300));
        for _ in 0..5 {
            l.record_fail("k");
        }
        assert_eq!(l.check("k"), Attempt::Locked); // 密码正确也进不来（check 先判锁）
    }

    /// 回归（SEC-002）：失败不占限速预算——窗口只计请求次数，失败单独计数
    #[test]
    fn fails_do_not_consume_window_budget() {
        let mut l = Limiter::new(3, Duration::from_secs(60), 5, Duration::from_secs(300));
        l.record_fail("k");
        l.record_fail("k");
        assert_eq!(l.check("k"), Attempt::Allowed);
        assert_eq!(l.check("k"), Attempt::Allowed);
        assert_eq!(l.check("k"), Attempt::Allowed);
        assert_eq!(l.check("k"), Attempt::RateLimited);
    }

    /// 回归（SEC-002）：成功清零失败历史——输错 1 次后改对，不积累锁定计数
    #[test]
    fn success_resets_fail_history() {
        let mut l = Limiter::new(100, Duration::from_secs(60), 2, Duration::from_secs(300));
        l.record_fail("k");
        l.record_success("k");
        l.record_fail("k");
        assert_eq!(l.check("k"), Attempt::Allowed); // fail 只有 1 次（<2），未锁
    }
}
