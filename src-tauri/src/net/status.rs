use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use ts_rs::TS;

use super::Transport;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum EndpointKind {
    Output,
    Input,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum EndpointState {
    Disabled,
    Starting,
    /// UDP socket bound, TCP connected, or TCP server listening.
    Ready,
    /// TCP output waiting for a connection.
    Connecting,
    Error,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct EndpointStats {
    pub tx_packets: u64,
    pub tx_bytes: u64,
    pub rx_packets: u64,
    pub rx_bytes: u64,
    pub errors: u64,
    /// Outbound packets held back because output is paused.
    pub blocked: u64,
    pub last_activity_micros: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct EndpointStatus {
    /// The desk (open preset) this endpoint belongs to. Ids are unique per desk only.
    pub desk: String,
    pub id: String,
    pub name: String,
    pub kind: EndpointKind,
    pub transport: Transport,
    pub state: EndpointState,
    pub local: Option<String>,
    pub remote: Option<String>,
    /// Last error, client count, joined group, ... Shown next to the state in the UI.
    pub detail: Option<String>,
    pub stats: EndpointStats,
}

/// Called whenever an endpoint's state (not its counters) changes.
pub type StatusListener = Arc<dyn Fn(&EndpointStatus) + Send + Sync>;

/// (desk, endpoint id): endpoints are namespaced by desk, so two desks may reuse ids.
pub type EndpointKey = (String, String);

pub fn key(desk: &str, id: &str) -> EndpointKey {
    (desk.to_string(), id.to_string())
}

/// Authoritative status + counters of every configured endpoint.
pub struct StatusBoard {
    map: Mutex<HashMap<EndpointKey, EndpointStatus>>,
    listener: StatusListener,
}

impl StatusBoard {
    pub fn new(listener: StatusListener) -> Self {
        Self {
            map: Mutex::new(HashMap::new()),
            listener,
        }
    }

    pub fn snapshot(&self) -> Vec<EndpointStatus> {
        self.map.lock().unwrap().values().cloned().collect()
    }

    pub fn get(&self, k: &EndpointKey) -> Option<EndpointStatus> {
        self.map.lock().unwrap().get(k).cloned()
    }

    pub(crate) fn insert(&self, status: EndpointStatus) {
        self.map
            .lock()
            .unwrap()
            .insert(key(&status.desk, &status.id), status.clone());
        (self.listener)(&status);
    }

    pub(crate) fn remove(&self, k: &EndpointKey) {
        self.map.lock().unwrap().remove(k);
    }

    /// Applies `f` to an endpoint's status. Notifies the listener only if `notify` is set, so
    /// per-packet counter updates don't flood the UI with events.
    pub(crate) fn update(
        &self,
        k: &EndpointKey,
        notify: bool,
        f: impl FnOnce(&mut EndpointStatus),
    ) {
        let snapshot = {
            let mut map = self.map.lock().unwrap();
            let Some(status) = map.get_mut(k) else {
                return;
            };
            f(status);
            notify.then(|| status.clone())
        };
        if let Some(status) = snapshot {
            (self.listener)(&status);
        }
    }
}
