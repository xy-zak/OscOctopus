use std::net::SocketAddr;
use std::sync::Arc;

use super::status::{key, EndpointKey, EndpointKind, EndpointState, StatusBoard};
use super::Transport;
use crate::debug::{now_micros, DebugEvent, DebugHub, DebugKind, Direction};
use crate::input::InputHub;
use crate::osc::decode_packet;

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
    pub input: Arc<InputHub>,
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

    /// Records an inbound packet, and hands it to input mapping if a widget listens on this
    /// endpoint and the packet didn't come from this app (or a sync peer app) itself.
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
        let origin = self.input.origin(remote);
        let for_input = match &decoded {
            Some(view) if origin.is_none() && self.input.accepts(&self.desk, &self.id) => {
                Some(view.clone())
            }
            _ => None,
        };
        let seq = self.debug.push(DebugEvent {
            direction: Some(Direction::In),
            local: addr(local),
            remote: Some(remote.to_string()),
            bytes: bytes.to_vec(),
            wire_len: wire_len.map(|n| n as u32),
            decoded,
            decode_error,
            origin,
            ..self.event(DebugKind::Packet)
        });
        if let Some(view) = for_input {
            self.input.offer(seq, &self.desk, &self.id, remote, &view);
        }
    }
}

fn split<T, E>(r: Result<T, E>) -> (Option<T>, Option<E>) {
    match r {
        Ok(v) => (Some(v), None),
        Err(e) => (None, Some(e)),
    }
}
