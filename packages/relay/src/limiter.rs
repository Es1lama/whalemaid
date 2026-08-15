// SPEC: docs/security-audit.md#SEC-002 限速与锁定
// 模型（架构修订 2026-08-15）：
// - check()：只门禁不消耗——按"失败窗口预算 + 锁定"判断是否放行（供 /connect）；
// - record_fail()：消耗失败窗口预算 + 失败计数（达 max_fails 锁定）；
// - record_success()：清零该 key 全部状态；
// - consume()：通用限速（register/status/tunnelws 等端点），每次调用消耗预算。
// 依据：主控端逐请求签 grant（每个静态资源一次 /connect）是合法高频；窗口预算只应压制口令猜测（失败）。
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

    /** 只门禁不消耗：锁定期拒绝；失败窗口预算用尽 → RateLimited；否则 Allowed（供 /connect） */
    pub fn check(&mut self, key: &str) -> Attempt {
        let (window, max_per_window) = (self.window, self.max_per_window);
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
            entry.locked_until = None;
            entry.fail_count = 0;
        }
        if now.duration_since(entry.window_start) >= window {
            entry.window_start = now;
            entry.window_count = 0;
        }
        if entry.window_count >= max_per_window {
            return Attempt::RateLimited
        }
        Attempt::Allowed
    }

    /** 通用限速：每次调用消耗预算（register/status/tunnelws 等） */
    pub fn consume(&mut self, key: &str) -> Attempt {
        match self.check(key) {
            Attempt::Allowed => {
                self.state.get_mut(key).unwrap().window_count += 1;
                Attempt::Allowed
            }
            other => other,
        }
    }

    /** 失败：消耗失败窗口预算 + 失败计数；达 max_fails 锁定 */
    pub fn record_fail(&mut self, key: &str) {
        let (window, max_fails, lock_for) = (self.window, self.max_fails, self.lock_for);
        let now = Instant::now();
        let entry = self.state.entry(key.to_string()).or_insert(Entry {
            window_start: now,
            window_count: 0,
            fail_count: 0,
            locked_until: None,
        });
        if now.duration_since(entry.window_start) >= window {
            entry.window_start = now;
            entry.window_count = 0;
        }
        entry.window_count += 1;
        entry.fail_count += 1;
        if entry.fail_count >= max_fails {
            entry.locked_until = Some(now + lock_for);
        }
    }

    /** 成功：清零该 key 全部状态（失败历史不跨口令累计） */
    pub fn record_success(&mut self, key: &str) {
        self.state.remove(key);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// /connect：成功验证不消耗窗口预算（逐请求签 grant 的高频场景，回归）
    #[test]
    fn successes_do_not_consume_window() {
        let mut l = Limiter::new(5, Duration::from_secs(60), 5, Duration::from_secs(300));
        for _ in 0..100 {
            assert_eq!(l.check("k"), Attempt::Allowed);
            l.record_success("k");
        }
    }

    /// /connect：失败消耗窗口预算——窗口内失败数达上限 → RateLimited
    #[test]
    fn fails_consume_window() {
        let mut l = Limiter::new(3, Duration::from_secs(60), 5, Duration::from_secs(300));
        for _ in 0..3 {
            l.record_fail("k");
        }
        assert_eq!(l.check("k"), Attempt::RateLimited);
    }

    /// /connect：连续失败锁定，锁定期内正确密码也拒（攻击路径）
    #[test]
    fn fail_lockout() {
        let mut l = Limiter::new(100, Duration::from_secs(60), 2, Duration::from_secs(300));
        l.record_fail("k");
        l.record_fail("k");
        assert_eq!(l.check("k"), Attempt::Locked);
        l.record_success("k");
        assert_eq!(l.check("k"), Attempt::Allowed);
    }

    /// 攻击路径（SEC-002）：锁定期内即使密码正确也拒绝
    #[test]
    fn lockout_denies_correct_password_during_lock() {
        let mut l = Limiter::new(100, Duration::from_secs(60), 5, Duration::from_secs(300));
        for _ in 0..5 {
            l.record_fail("k");
        }
        assert_eq!(l.check("k"), Attempt::Locked);
    }

    /// 成功清零失败历史——输错 1 次后改对，不积累锁定计数
    #[test]
    fn success_resets_fail_history() {
        let mut l = Limiter::new(100, Duration::from_secs(60), 2, Duration::from_secs(300));
        l.record_fail("k");
        l.record_success("k");
        l.record_fail("k");
        assert_eq!(l.check("k"), Attempt::Allowed); // fail 只有 1 次（<2），未锁
    }

    /// 通用限速（register/status/tunnelws）：每次消耗预算
    #[test]
    fn consume_window_rate_limit() {
        let mut l = Limiter::new(3, Duration::from_secs(60), 5, Duration::from_secs(300));
        assert_eq!(l.consume("k"), Attempt::Allowed);
        assert_eq!(l.consume("k"), Attempt::Allowed);
        assert_eq!(l.consume("k"), Attempt::Allowed);
        assert_eq!(l.consume("k"), Attempt::RateLimited);
    }
}
