//! Peer-to-peer sync between OscOctopus apps. There is no server: every app in a session
//! connects to every other app it can reach.
//!
//! Rust is only the transport. It handles identity, the encrypted channel, discovery,
//! heartbeats, limits and queues. App payloads (desks, values, presence) pass through unread
//! apart from an envelope check; the frontend owns their meaning (`src/lib/sync/`).

pub mod discovery;
pub mod docs;
pub mod identity;
mod manager;
pub mod noise;
pub mod peer;
pub mod ratelimit;
pub mod wire;

use std::collections::VecDeque;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;
use ts_rs::TS;

pub use manager::{SyncManager, SyncOptions};
use wire::AppKind;

/// The port apps listen on for sync unless configured otherwise.
pub const DEFAULT_PORT: u16 = 9701;
/// Inbound messages buffered between UI flushes; beyond it new messages are dropped (counted).
pub const INBOX_CAP: usize = 10_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SyncConfig {
    /// TCP port to listen on. If it is taken, a free port is used instead (and reported).
    pub port: u16,
    /// Find apps in the same session on the LAN (mDNS).
    pub discovery: bool,
    /// `host:port` of apps to connect to directly (when discovery can't reach them).
    pub manual_peers: Vec<String>,
}

impl Default for SyncConfig {
    fn default() -> Self {
        Self {
            port: DEFAULT_PORT,
            discovery: true,
            manual_peers: Vec::new(),
        }
    }
}

/// How this device shows up to others.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Profile {
    pub name: String,
    /// An index into the frontend's peer palette.
    pub color: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum PeerSource {
    Manual,
    Discovered,
    /// It connected to us.
    Incoming,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum PeerState {
    Connecting,
    Connected,
    /// The last attempt failed; trying again after a delay.
    Retrying,
    /// The other side (or this one) turned the connection down: wrong key, other session,
    /// blocked, incompatible version. Still retried, slowly.
    Refused,
}

#[derive(Debug, Clone, Default, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PeerStats {
    pub rx_msgs: u64,
    pub tx_msgs: u64,
    pub rx_bytes: u64,
    pub tx_bytes: u64,
    /// Inbound messages refused: over the rate limit or malformed.
    pub rejected: u64,
    /// Live values not sent because the peer was too slow (newer ones replace them).
    pub dropped_values: u64,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PeerStatus {
    /// Known once a connection was authenticated.
    pub peer_id: Option<String>,
    pub fingerprint: Option<String>,
    /// Where it is (or is being dialled), e.g. "192.168.1.30:9701".
    pub address: String,
    pub source: PeerSource,
    pub state: PeerState,
    pub name: Option<String>,
    pub color: Option<u8>,
    pub app_version: Option<String>,
    pub rtt_ms: Option<f64>,
    /// How far its clock is ahead of this one.
    pub clock_offset_ms: Option<f64>,
    pub connected_since_ms: Option<f64>,
    pub stats: PeerStats,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LocalStatus {
    pub peer_id: String,
    pub fingerprint: String,
    pub instance_id: String,
    pub profile: Profile,
    /// Set if the saved device identity could not be read (a temporary one is in use).
    pub identity_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SyncStatus {
    pub local: LocalStatus,
    pub config: SyncConfig,
    /// The joined session's name, if any.
    pub session: Option<String>,
    /// The port actually listened on.
    pub listening: Option<u16>,
    pub listen_error: Option<String>,
    pub discovery_active: bool,
    pub discovery_error: Option<String>,
    pub peers: Vec<PeerStatus>,
    pub blocked: Vec<String>,
}

/// A connected peer, as announced to the frontend.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PeerInfo {
    pub peer_id: String,
    pub fingerprint: String,
    pub name: String,
    pub color: u8,
    pub app_version: String,
    pub address: String,
}

/// What the frontend receives, in order per peer: `up`, its messages, then `down`.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(tag = "type", rename_all = "camelCase")]
#[ts(export)]
pub enum SyncEvent {
    Up {
        peer: PeerInfo,
    },
    Down {
        peer: String,
        reason: String,
    },
    Message {
        peer: String,
        kind: AppKind,
        desk: Option<String>,
        /// JSON, checked for well-formedness only: the frontend validates it.
        #[ts(type = "unknown")]
        body: Box<RawValue>,
    },
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SyncBatch {
    pub events: Vec<SyncEvent>,
    /// Messages discarded since the previous batch because the UI was not keeping up.
    pub dropped: u64,
    pub total_dropped: u64,
}

#[derive(Default)]
struct InboxQueue {
    events: VecDeque<SyncEvent>,
    dropped: u64,
    total_dropped: u64,
}

/// Inbound events waiting for the next UI flush.
pub struct SyncInbox {
    queue: Mutex<InboxQueue>,
    cap: usize,
}

impl SyncInbox {
    pub fn new(cap: usize) -> Self {
        Self {
            queue: Mutex::default(),
            cap,
        }
    }

    /// Queues an event. Peer up/down are always kept; messages beyond the cap are dropped
    /// (and counted), which the frontend's periodic digests repair.
    fn push(&self, event: SyncEvent) {
        let mut q = self.queue.lock().unwrap();
        if matches!(event, SyncEvent::Message { .. }) && q.events.len() >= self.cap {
            q.dropped += 1;
            q.total_dropped += 1;
            return;
        }
        q.events.push_back(event);
    }

    /// Takes everything queued since the last call; `None` if there is nothing new.
    pub fn drain(&self) -> Option<SyncBatch> {
        let mut q = self.queue.lock().unwrap();
        if q.events.is_empty() && q.dropped == 0 {
            return None;
        }
        let batch = SyncBatch {
            events: q.events.drain(..).collect(),
            dropped: q.dropped,
            total_dropped: q.total_dropped,
        };
        q.dropped = 0;
        Some(batch)
    }
}
