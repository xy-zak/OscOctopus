//! Sync messages as they travel inside the encrypted channel: `[kind][desk len][desk][body]`,
//! where the body is JSON. Rust owns the few control kinds (hello, ping, pong, bye). The app
//! kinds belong to the frontend, which owns desk semantics.
//!
//! Rust checks only the envelope of app kinds before passing them on unread:
//! - a known kind;
//! - a valid desk id where one is required;
//! - the size cap for the kind;
//! - a well-formed JSON body.

use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;
use ts_rs::TS;

/// The sync protocol version. A different major version can't talk to this one (refused in
/// the preamble, before any crypto); minor versions stay compatible.
pub const PROTOCOL: (u16, u16) = (1, 0);

/// Largest message, after reassembling chunks.
pub const MAX_MESSAGE: usize = 4 * 1024 * 1024;
/// Longest device name accepted from a peer (longer ones are cut).
pub const MAX_NAME_CHARS: usize = 40;
/// Most OSC ports a peer may declare.
pub const MAX_PORTS: usize = 256;

const HELLO: u8 = 1;
const PING: u8 = 2;
const PONG: u8 = 3;
const BYE: u8 = 4;

/// Message kinds the frontend sends and receives. Their bodies are opaque to Rust.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum AppKind {
    /// Who is here, what they view and edit (soft locks). Not tied to a desk.
    Presence,
    /// The shared desks this peer has open.
    DeskAnnounce,
    DeskRequest,
    DeskState,
    DeskOps,
    DeskDigest,
    /// Live widget values. May be dropped under load: a periodic full refresh repairs them.
    Values,
}

impl AppKind {
    const ALL: [AppKind; 7] = [
        AppKind::Presence,
        AppKind::DeskAnnounce,
        AppKind::DeskRequest,
        AppKind::DeskState,
        AppKind::DeskOps,
        AppKind::DeskDigest,
        AppKind::Values,
    ];

    fn code(self) -> u8 {
        16 + Self::ALL.iter().position(|k| *k == self).unwrap() as u8
    }

    fn from_code(code: u8) -> Option<Self> {
        code.checked_sub(16)
            .and_then(|i| Self::ALL.get(i as usize).copied())
    }

    /// The most a body of this kind may weigh.
    pub fn max_body(self) -> usize {
        match self {
            AppKind::DeskState => MAX_MESSAGE - 128,
            AppKind::DeskOps => 1024 * 1024,
            AppKind::Values => 256 * 1024,
            _ => 32 * 1024,
        }
    }

    /// Kinds that concern one desk carry its id; the others must not.
    pub fn has_desk(self) -> bool {
        !matches!(self, AppKind::Presence | AppKind::DeskAnnounce)
    }

    /// Values are replaced by newer ones anyway, so they may be dropped when a peer is slow.
    pub fn droppable(self) -> bool {
        self == AppKind::Values
    }
}

/// Same grammar as preset ids (`IdSchema` in the frontend): 1-64 of A-Z a-z 0-9 - _.
pub fn valid_id(s: &str) -> bool {
    (1..=64).contains(&s.len())
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Hello {
    pub proto: (u16, u16),
    pub app_version: String,
    /// Desks only merge between the same preset schema version.
    pub schema_version: u32,
    /// Random per launch: tells a copy of this device's identity apart from a self-connection.
    pub instance_id: String,
    pub name: String,
    pub color: u8,
    /// This app's OSC output ports: its packets must not drive the peer's widgets.
    pub osc_ports: Vec<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Ping {
    pub seq: u64,
    pub wall_ms: f64,
    /// Current OSC output ports, name and colour: they can change while connected.
    pub osc_ports: Vec<u16>,
    pub name: String,
    pub color: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Pong {
    pub seq: u64,
    /// The ping's own time, echoed back.
    pub wall_ms: f64,
    /// The answering peer's clock.
    pub peer_wall_ms: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ByeReason {
    Leaving,
    Duplicate,
    Blocked,
    Incompatible,
    Overload,
    SelfConnection,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Bye {
    pub reason: ByeReason,
    pub detail: Option<String>,
}

/// A decoded message.
#[derive(Debug)]
pub enum Message {
    Hello(Hello),
    Ping(Ping),
    Pong(Pong),
    Bye(Bye),
    App {
        kind: AppKind,
        desk: Option<String>,
        body: Box<RawValue>,
    },
}

fn encode_raw(code: u8, desk: Option<&str>, body: &[u8]) -> Vec<u8> {
    let desk = desk.unwrap_or("");
    let mut out = Vec::with_capacity(2 + desk.len() + body.len());
    out.push(code);
    out.push(desk.len() as u8);
    out.extend_from_slice(desk.as_bytes());
    out.extend_from_slice(body);
    out
}

pub fn encode_control(msg: &Message) -> Vec<u8> {
    let (code, body) = match msg {
        Message::Hello(h) => (HELLO, serde_json::to_vec(h)),
        Message::Ping(p) => (PING, serde_json::to_vec(p)),
        Message::Pong(p) => (PONG, serde_json::to_vec(p)),
        Message::Bye(b) => (BYE, serde_json::to_vec(b)),
        Message::App { .. } => unreachable!("app messages are encoded with encode_app"),
    };
    encode_raw(code, None, &body.expect("control messages serialize"))
}

/// Checks and encodes an app message from the frontend.
pub fn encode_app(kind: AppKind, desk: Option<&str>, body: &str) -> Result<Vec<u8>, String> {
    check_app(kind, desk, body.as_bytes())?;
    Ok(encode_raw(kind.code(), desk, body.as_bytes()))
}

fn check_app(kind: AppKind, desk: Option<&str>, body: &[u8]) -> Result<(), String> {
    match (kind.has_desk(), desk) {
        (true, Some(d)) if valid_id(d) => {}
        (true, Some(d)) => return Err(format!("invalid desk id '{d}'")),
        (true, None) => return Err(format!("{kind:?} needs a desk id")),
        (false, Some(_)) => return Err(format!("{kind:?} takes no desk id")),
        (false, None) => {}
    }
    if body.len() > kind.max_body() {
        return Err(format!(
            "{kind:?} message of {} bytes exceeds {}",
            body.len(),
            kind.max_body()
        ));
    }
    serde_json::from_slice::<&RawValue>(body).map_err(|e| format!("body is not JSON: {e}"))?;
    Ok(())
}

pub fn decode(bytes: &[u8]) -> Result<Message, String> {
    let [code, desk_len, rest @ ..] = bytes else {
        return Err("truncated message".into());
    };
    let desk_len = *desk_len as usize;
    if rest.len() < desk_len {
        return Err("truncated desk id".into());
    }
    let (desk, body) = rest.split_at(desk_len);
    let desk = std::str::from_utf8(desk).map_err(|_| "desk id is not UTF-8".to_string())?;
    let control = |what: &str| -> Result<(), String> {
        if desk.is_empty() {
            Ok(())
        } else {
            Err(format!("{what} takes no desk id"))
        }
    };
    let json = |what: &str, e: serde_json::Error| format!("bad {what}: {e}");
    match *code {
        HELLO => {
            control("hello")?;
            Ok(Message::Hello(
                serde_json::from_slice(body).map_err(|e| json("hello", e))?,
            ))
        }
        PING => {
            control("ping")?;
            Ok(Message::Ping(
                serde_json::from_slice(body).map_err(|e| json("ping", e))?,
            ))
        }
        PONG => {
            control("pong")?;
            Ok(Message::Pong(
                serde_json::from_slice(body).map_err(|e| json("pong", e))?,
            ))
        }
        BYE => {
            control("bye")?;
            Ok(Message::Bye(
                serde_json::from_slice(body).map_err(|e| json("bye", e))?,
            ))
        }
        other => {
            let kind = AppKind::from_code(other).ok_or_else(|| format!("unknown kind {other}"))?;
            let desk = (!desk.is_empty()).then(|| desk.to_string());
            check_app(kind, desk.as_deref(), body)?;
            let body = serde_json::from_slice::<Box<RawValue>>(body)
                .map_err(|e| format!("body is not JSON: {e}"))?;
            Ok(Message::App { kind, desk, body })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_messages_round_trip_unread() {
        let bytes = encode_app(AppKind::DeskOps, Some("desk-1"), r#"{"ops":[1,2]}"#).unwrap();
        match decode(&bytes).unwrap() {
            Message::App { kind, desk, body } => {
                assert_eq!(kind, AppKind::DeskOps);
                assert_eq!(desk.as_deref(), Some("desk-1"));
                assert_eq!(body.get(), r#"{"ops":[1,2]}"#);
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn control_messages_round_trip() {
        let bye = Message::Bye(Bye {
            reason: ByeReason::Leaving,
            detail: None,
        });
        assert!(matches!(
            decode(&encode_control(&bye)).unwrap(),
            Message::Bye(Bye {
                reason: ByeReason::Leaving,
                ..
            })
        ));
    }

    #[test]
    fn rejects_bad_envelopes() {
        assert!(
            encode_app(AppKind::DeskOps, None, "{}").is_err(),
            "desk required"
        );
        assert!(
            encode_app(AppKind::Presence, Some("d"), "{}").is_err(),
            "no desk allowed"
        );
        assert!(encode_app(AppKind::DeskOps, Some("../x"), "{}").is_err());
        assert!(encode_app(AppKind::DeskOps, Some("__x"), "{ nope").is_err());
        let big = format!("\"{}\"", "x".repeat(40 * 1024));
        assert!(
            encode_app(AppKind::Presence, None, &big).is_err(),
            "over the kind's cap"
        );
        assert!(encode_app(AppKind::DeskState, Some("d"), &big).is_ok());

        assert!(decode(&[]).is_err());
        assert!(decode(&[99, 0, b'{', b'}']).is_err(), "unknown kind");
        assert!(decode(&[16, 5, b'a']).is_err(), "truncated desk");
        assert!(
            decode(&[HELLO, 1, b'd', b'{', b'}']).is_err(),
            "control with a desk"
        );
        let mut malformed = encode_app(AppKind::Values, Some("d"), "{}").unwrap();
        malformed.pop();
        assert!(decode(&malformed).is_err(), "body not JSON");
    }
}
