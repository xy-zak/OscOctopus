//! Per-peer inbound limits: a token bucket for messages and one for bytes. A peer that keeps
//! exceeding them (flooding) is disconnected; a burst is only trimmed.

use std::time::Instant;

pub struct TokenBucket {
    capacity: f64,
    tokens: f64,
    per_sec: f64,
    last: Instant,
}

impl TokenBucket {
    pub fn new(per_sec: f64, burst: f64) -> Self {
        Self {
            capacity: burst,
            tokens: burst,
            per_sec,
            last: Instant::now(),
        }
    }

    /// Takes `n` tokens if available.
    pub fn take(&mut self, n: f64, now: Instant) -> bool {
        let elapsed = now.saturating_duration_since(self.last).as_secs_f64();
        self.last = now;
        self.tokens = (self.tokens + elapsed * self.per_sec).min(self.capacity);
        if self.tokens >= n {
            self.tokens -= n;
            true
        } else {
            false
        }
    }
}

/// Messages per second a peer may send (with a burst allowance), and bytes per second.
pub const MSGS_PER_SEC: f64 = 300.0;
pub const MSGS_BURST: f64 = 600.0;
pub const BYTES_PER_SEC: f64 = 4.0 * 1024.0 * 1024.0;
pub const BYTES_BURST: f64 = 8.0 * 1024.0 * 1024.0;
/// Messages refused in a row before the peer counts as flooding and is disconnected.
pub const FLOOD_REFUSALS: u32 = 2_000;

pub struct Limiter {
    msgs: TokenBucket,
    bytes: TokenBucket,
    refused_in_a_row: u32,
}

pub enum Verdict {
    Accept,
    /// Over the limit: drop this message.
    Drop,
    /// Over the limit for too long: disconnect.
    Flooding,
}

impl Default for Limiter {
    fn default() -> Self {
        Self {
            msgs: TokenBucket::new(MSGS_PER_SEC, MSGS_BURST),
            bytes: TokenBucket::new(BYTES_PER_SEC, BYTES_BURST),
            refused_in_a_row: 0,
        }
    }
}

impl Limiter {
    pub fn check(&mut self, size: usize, now: Instant) -> Verdict {
        if self.msgs.take(1.0, now) && self.bytes.take(size as f64, now) {
            self.refused_in_a_row = 0;
            return Verdict::Accept;
        }
        self.refused_in_a_row += 1;
        if self.refused_in_a_row >= FLOOD_REFUSALS {
            Verdict::Flooding
        } else {
            Verdict::Drop
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn allows_a_burst_then_the_rate() {
        let t0 = Instant::now();
        let mut b = TokenBucket::new(10.0, 5.0);
        assert!((0..5).all(|_| b.take(1.0, t0)));
        assert!(!b.take(1.0, t0));
        assert!(b.take(1.0, t0 + Duration::from_millis(100)));
        assert!(!b.take(1.0, t0 + Duration::from_millis(100)));
    }

    #[test]
    fn a_sustained_flood_is_flagged() {
        let t0 = Instant::now();
        let mut l = Limiter::default();
        let verdicts: Vec<Verdict> = (0..MSGS_BURST as usize + FLOOD_REFUSALS as usize)
            .map(|_| l.check(10, t0))
            .collect();
        assert!(matches!(verdicts[0], Verdict::Accept));
        assert!(matches!(verdicts[MSGS_BURST as usize], Verdict::Drop));
        assert!(matches!(verdicts.last().unwrap(), Verdict::Flooding));
    }
}
