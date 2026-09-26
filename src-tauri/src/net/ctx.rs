use std::net::SocketAddr;
use std::sync::Arc;

use serde::Serialize;
use ts_rs::TS;

use super::status::{key, EndpointKey, EndpointKind, EndpointState, StatusBoard};
use super::Transport;
use crate::debug::{now_micros, DebugEvent, DebugHub, DebugKind, Direction};
use crate::osc::{decode_packet, OscPacketView};

/// A successfully decoded inbound packet, forwarded to the frontend for widget feedback.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct IncomingOsc {
    pub desk: String,
    pub endpoint_id: String,
    pub remote: Option<String>,
    pub packet: OscPacketView,
}

pub type IncomingListener = Arc<dyn Fn(IncomingOsc) + Send + Sync>;

/// Everything an endpoint task needs to report what it is doing.
#[derive(Clone)]
pub(crate) struct Ctx {
    pub desk: String,
    pub id: String,
    pub name: String,
    pub kind: EndpointKind,
    pub transport: Transport,
    pub board: Arc<StatusBoard>,
    pub debug: Arc<DebugHub>,
    pub incoming: IncomingListener,
}

fn addr(a: Option<SocketAddr>) -> Option<String> {
    a.map(|a| a.to_string())
}

impl Ctx {
    pub fn key(&self) -> EndpointKey {
        key(&self.desk, &self.id)
    }

    fn event(&self, kind: DebugKind) -> DebugEvent {
        DebugEvent {
            kind,
            desk: Some(self.desk.clone()),
            endpoint_id: self.id.clone(),
            endpoint_name: self.name.clone(),
            transport: Some(self.transport),
            ..Default::default()
        }
    }

    pub fn set_state(
        &self,
        state: EndpointState,
        local: Option<SocketAddr>,
        remote: Option<String>,
        detail: Option<String>,
    ) {
        self.board.update(&self.key(), true, |s| {
            s.state = state;
            s.local = addr(local);
            s.remote = remote;
            s.detail = detail;
        });
    }

    pub fn set_detail(&self, detail: Option<String>) {
        self.board.update(&self.key(), true, |s| s.detail = detail);
    }

    pub fn info(&self, message: impl Into<String>) {
        self.debug.push(DebugEvent {
            message: Some(message.into()),
            ..self.event(DebugKind::Info)
        });
    }

    pub fn error(&self, error: impl Into<String>) {
        self.board
            .update(&self.key(), false, |s| s.stats.errors += 1);
        self.debug.push(DebugEvent {
            error: Some(error.into()),
            ..self.event(DebugKind::Error)
        });
    }

    /// Records an outbound packet *after* the socket call returned, with its real result.
    pub fn packet_out(
        &self,
        bytes: &[u8],
        wire_len: usize,
        local: Option<SocketAddr>,
        remote: String,
        result: Result<(), String>,
        source: Option<&str>,
    ) {
        let ok = result.is_ok();
        self.board.update(&self.key(), false, |s| {
            if ok {
                s.stats.tx_packets += 1;
                s.stats.tx_bytes += wire_len as u64;
            } else {
                s.stats.errors += 1;
            }
            s.stats.last_activity_micros = Some(now_micros());
        });
        let (decoded, decode_error) = split(decode_packet(bytes));
        self.debug.push(DebugEvent {
            direction: Some(Direction::Out),
            local: addr(local),
            remote: Some(remote),
            bytes: bytes.to_vec(),
            wire_len: Some(wire_len as u32),
            decoded,
            decode_error,
            error: result.err(),
            source: source.map(str::to_string),
            ..self.event(DebugKind::Packet)
        });
    }

    /// Records a packet that would have been sent to this output, but was held back because
    /// output is paused. Shows the exact bytes that would have left.
    pub fn packet_blocked(&self, bytes: &[u8], source: Option<&str>) {
        self.board.update(&self.key(), false, |s| {
            s.stats.blocked += 1;
            s.stats.last_activity_micros = Some(now_micros());
        });
        let (decoded, decode_error) = split(decode_packet(bytes));
        self.debug.push(DebugEvent {
            direction: Some(Direction::Out),
            bytes: bytes.to_vec(),
            decoded,
            decode_error,
            blocked: true,
            message: Some("output paused: packet not sent".into()),
            source: source.map(str::to_string),
            ..self.event(DebugKind::Packet)
        });
    }

    /// Records an inbound packet and forwards it to the frontend if it decodes.
    pub fn packet_in(
        &self,
        bytes: &[u8],
        wire_len: Option<usize>,
        local: Option<SocketAddr>,
        remote: SocketAddr,
    ) {
        self.board.update(&self.key(), false, |s| {
            s.stats.rx_packets += 1;
            s.stats.rx_bytes += wire_len.unwrap_or(bytes.len()) as u64;
            s.stats.last_activity_micros = Some(now_micros());
        });
        let (decoded, decode_error) = split(decode_packet(bytes));
        if let Some(packet) = &decoded {
            (self.incoming)(IncomingOsc {
                desk: self.desk.clone(),
                endpoint_id: self.id.clone(),
                remote: Some(remote.to_string()),
                packet: packet.clone(),
            });
        }
        self.debug.push(DebugEvent {
            direction: Some(Direction::In),
            local: addr(local),
            remote: Some(remote.to_string()),
            bytes: bytes.to_vec(),
            wire_len: wire_len.map(|n| n as u32),
            decoded,
            decode_error,
            ..self.event(DebugKind::Packet)
        });
    }
}

fn split<T, E>(r: Result<T, E>) -> (Option<T>, Option<E>) {
    match r {
        Ok(v) => (Some(v), None),
        Err(e) => (None, Some(e)),
    }
}
