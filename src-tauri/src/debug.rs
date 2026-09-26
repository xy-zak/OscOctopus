//! The debug pipeline. Every packet that touches a socket, and every lifecycle change of an
//! endpoint, becomes a `DebugEvent`. Events are sequence-numbered so the UI can prove it has
//! not missed any; if the UI falls behind, the number of dropped events is reported explicitly.

use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use ts_rs::TS;

use crate::input::Origin;
use crate::net::Transport;
use crate::osc::OscPacketView;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum DebugKind {
    /// An OSC packet was sent or received (possibly with an error attached).
    #[default]
    Packet,
    /// Lifecycle information: socket bound, peer connected, etc.
    Info,
    /// Something failed outside of a specific packet (bind failure, connect failure, ...).
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Direction {
    Out,
    In,
}

#[derive(Debug, Clone, Default, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DebugEvent {
    pub seq: u64,
    /// Wall-clock time in microseconds since the Unix epoch.
    pub ts_micros: u64,
    pub kind: DebugKind,
    pub direction: Option<Direction>,
    /// Desk (open preset) the endpoint belongs to; `None` for app-wide events.
    pub desk: Option<String>,
    pub endpoint_id: String,
    pub endpoint_name: String,
    pub transport: Option<Transport>,
    /// Local socket address, e.g. "192.168.1.20:53211".
    pub local: Option<String>,
    /// Remote socket address the packet went to / came from.
    pub remote: Option<String>,
    /// The raw OSC packet bytes, exactly as handed to / received from the socket
    /// (before TCP framing is applied / after it is removed).
    pub bytes: Vec<u8>,
    /// Number of bytes actually written to the wire, including TCP framing. `None` when it
    /// cannot be known exactly (e.g. inbound TCP streams).
    pub wire_len: Option<u32>,
    pub decoded: Option<OscPacketView>,
    pub decode_error: Option<String>,
    /// OS / transport error for this packet or lifecycle event, verbatim.
    pub error: Option<String>,
    /// Human-readable note for info events.
    pub message: Option<String>,
    /// Id of the widget that caused an outbound packet, if any.
    pub source: Option<String>,
    /// True for an outbound packet that was held back because output is paused.
    pub blocked: bool,
    /// Set for an inbound packet sent by this app (or a sync peer app): never applied to widgets.
    pub origin: Option<Origin>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DebugBatch {
    pub events: Vec<DebugEvent>,
    /// Events discarded since the previous batch because the UI was not keeping up.
    pub dropped: u64,
    pub total_dropped: u64,
}

pub fn now_micros() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_micros() as u64)
        .unwrap_or(0)
}

struct Inner {
    next_seq: u64,
    history: VecDeque<DebugEvent>,
    pending: VecDeque<DebugEvent>,
    dropped: u64,
    total_dropped: u64,
}

pub struct DebugHub {
    inner: Mutex<Inner>,
    history_cap: usize,
    pending_cap: usize,
}

impl DebugHub {
    /// `history_cap`: events kept for late subscribers / export.
    /// `pending_cap`: events buffered between UI flushes before the oldest are dropped.
    pub fn new(history_cap: usize, pending_cap: usize) -> Self {
        Self {
            inner: Mutex::new(Inner {
                next_seq: 1,
                history: VecDeque::with_capacity(history_cap),
                pending: VecDeque::new(),
                dropped: 0,
                total_dropped: 0,
            }),
            history_cap,
            pending_cap,
        }
    }

    /// Records an event; returns the sequence number it was given.
    pub fn push(&self, mut event: DebugEvent) -> u64 {
        let mut inner = self.inner.lock().unwrap();
        let seq = inner.next_seq;
        event.seq = seq;
        inner.next_seq += 1;
        if event.ts_micros == 0 {
            event.ts_micros = now_micros();
        }
        if inner.history.len() >= self.history_cap {
            inner.history.pop_front();
        }
        inner.history.push_back(event.clone());
        if inner.pending.len() >= self.pending_cap {
            inner.pending.pop_front();
            inner.dropped += 1;
            inner.total_dropped += 1;
        }
        inner.pending.push_back(event);
        seq
    }

    /// Takes everything buffered since the last call. Returns `None` if there is nothing new.
    pub fn drain(&self) -> Option<DebugBatch> {
        let mut inner = self.inner.lock().unwrap();
        if inner.pending.is_empty() && inner.dropped == 0 {
            return None;
        }
        let batch = DebugBatch {
            events: inner.pending.drain(..).collect(),
            dropped: inner.dropped,
            total_dropped: inner.total_dropped,
        };
        inner.dropped = 0;
        Some(batch)
    }

    pub fn history(&self) -> Vec<DebugEvent> {
        self.inner.lock().unwrap().history.iter().cloned().collect()
    }

    pub fn total_dropped(&self) -> u64 {
        self.inner.lock().unwrap().total_dropped
    }

    pub fn clear(&self) {
        let mut inner = self.inner.lock().unwrap();
        inner.history.clear();
        inner.pending.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sequences_and_reports_drops() {
        let hub = DebugHub::new(3, 2);
        for _ in 0..5 {
            hub.push(DebugEvent::default());
        }
        let batch = hub.drain().unwrap();
        assert_eq!(batch.dropped, 3);
        assert_eq!(
            batch.events.iter().map(|e| e.seq).collect::<Vec<_>>(),
            [4, 5]
        );
        assert_eq!(hub.history().len(), 3);
        assert!(hub.drain().is_none());
    }
}
