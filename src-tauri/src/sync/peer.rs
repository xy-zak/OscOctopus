//! One authenticated link to a peer: what waits to be sent to it, and its counters.
//!
//! Two classes of outbound messages:
//! - **values** are droppable: a slow peer loses the oldest, counted. The periodic full
//!   refresh of values repairs any gap.
//! - **everything else** is reliable, in order. The queue is bounded; overflowing it
//!   disconnects the peer, which resyncs on reconnect (anti-entropy).

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::io::AsyncWrite;
use tokio::sync::Notify;

use super::noise::{write_frame, Sealer};

pub const RELIABLE_MAX_MSGS: usize = 512;
pub const RELIABLE_MAX_BYTES: usize = 8 * 1024 * 1024;
pub const VALUES_MAX_MSGS: usize = 256;

#[derive(Default)]
struct Queues {
    reliable: VecDeque<Vec<u8>>,
    reliable_bytes: usize,
    values: VecDeque<Vec<u8>>,
    /// Why the link is closing (set once).
    closed: Option<String>,
}

#[derive(Default)]
pub struct Outbox {
    queues: Mutex<Queues>,
    ready: Notify,
    pub dropped_values: AtomicU64,
}

impl Outbox {
    /// Queues a reliable message; false if the queue is full (the caller closes the link).
    pub fn push_reliable(&self, msg: Vec<u8>) -> bool {
        let mut q = self.queues.lock().unwrap();
        if q.closed.is_some() {
            return true;
        }
        if q.reliable.len() >= RELIABLE_MAX_MSGS
            || q.reliable_bytes + msg.len() > RELIABLE_MAX_BYTES
        {
            return false;
        }
        q.reliable_bytes += msg.len();
        q.reliable.push_back(msg);
        drop(q);
        self.ready.notify_one();
        true
    }

    /// Queues a droppable message, dropping (and counting) the oldest if the queue is full.
    pub fn push_value(&self, msg: Vec<u8>) {
        let mut q = self.queues.lock().unwrap();
        if q.closed.is_some() {
            return;
        }
        if q.values.len() >= VALUES_MAX_MSGS {
            q.values.pop_front();
            self.dropped_values.fetch_add(1, Ordering::Relaxed);
        }
        q.values.push_back(msg);
        drop(q);
        self.ready.notify_one();
    }

    /// Starts closing: what is already queued as reliable (e.g. a Bye) is still sent.
    pub fn close(&self, reason: impl Into<String>) {
        self.shut(reason.into(), false);
    }

    /// Closes and discards everything still queued (the peer is gone or not reading).
    pub fn abort(&self, reason: impl Into<String>) {
        self.shut(reason.into(), true);
    }

    fn shut(&self, reason: String, discard: bool) {
        let mut q = self.queues.lock().unwrap();
        if q.closed.is_none() {
            q.closed = Some(reason);
        }
        q.values.clear();
        if discard {
            q.reliable.clear();
            q.reliable_bytes = 0;
        }
        drop(q);
        self.ready.notify_waiters();
        self.ready.notify_one();
    }

    pub fn closed_reason(&self) -> Option<String> {
        self.queues.lock().unwrap().closed.clone()
    }

    /// Resolves once `close` was called.
    pub async fn wait_closed(&self) -> String {
        loop {
            let notified = self.ready.notified();
            if let Some(reason) = self.closed_reason() {
                return reason;
            }
            notified.await;
        }
    }

    /// The next message to send (reliable first); None once closed and drained.
    async fn next(&self) -> Option<Vec<u8>> {
        loop {
            let notified = self.ready.notified();
            {
                let mut q = self.queues.lock().unwrap();
                if let Some(msg) = q.reliable.pop_front() {
                    q.reliable_bytes -= msg.len();
                    return Some(msg);
                }
                if let Some(msg) = q.values.pop_front() {
                    return Some(msg);
                }
                if q.closed.is_some() {
                    return None;
                }
            }
            notified.await;
        }
    }
}

#[derive(Default)]
pub struct LinkStats {
    pub rx_msgs: AtomicU64,
    pub tx_msgs: AtomicU64,
    pub rx_bytes: AtomicU64,
    pub tx_bytes: AtomicU64,
    /// Inbound messages refused: over the rate limit, malformed, or for a desk not shared here.
    pub rejected: AtomicU64,
    pub rtt_ms: Mutex<Option<f64>>,
    pub clock_offset_ms: Mutex<Option<f64>>,
}

/// Sends queued messages until the outbox is closed and drained, or a write fails or stalls.
pub async fn write_loop<W: AsyncWrite + Unpin>(
    mut writer: W,
    mut sealer: Sealer,
    outbox: Arc<Outbox>,
    stats: Arc<LinkStats>,
    write_timeout: Duration,
) {
    while let Some(msg) = outbox.next().await {
        let frames = match sealer.seal(&msg) {
            Ok(frames) => frames,
            Err(e) => return outbox.abort(e),
        };
        for frame in frames {
            match tokio::time::timeout(write_timeout, write_frame(&mut writer, &frame)).await {
                Ok(Ok(())) => {}
                Ok(Err(e)) => return outbox.abort(format!("write failed: {e}")),
                Err(_) => return outbox.abort("peer stopped reading (write timed out)"),
            }
            stats
                .tx_bytes
                .fetch_add(frame.len() as u64 + 4, Ordering::Relaxed);
        }
        stats.tx_msgs.fetch_add(1, Ordering::Relaxed);
    }
    let _ = tokio::io::AsyncWriteExt::shutdown(&mut writer).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reliable_queue_is_bounded_and_values_drop_the_oldest() {
        let out = Outbox::default();
        for _ in 0..RELIABLE_MAX_MSGS {
            assert!(out.push_reliable(vec![0]));
        }
        assert!(!out.push_reliable(vec![0]), "full");
        for n in 0..VALUES_MAX_MSGS + 3 {
            out.push_value(vec![n as u8]);
        }
        assert_eq!(out.dropped_values.load(Ordering::Relaxed), 3);
    }

    #[tokio::test]
    async fn closing_still_sends_what_is_queued_then_ends() {
        let out = Outbox::default();
        out.push_value(vec![9]);
        out.push_reliable(vec![1]);
        out.close("bye");
        assert_eq!(
            out.next().await,
            Some(vec![1]),
            "reliable (the Bye) still goes"
        );
        assert_eq!(out.next().await, None, "values dropped on close");
        assert_eq!(out.wait_closed().await, "bye");

        let out = Outbox::default();
        out.push_reliable(vec![1]);
        out.abort("gone");
        assert_eq!(out.next().await, None, "abort discards everything");
    }
}
