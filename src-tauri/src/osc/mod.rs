//! OSC data model shared with the frontend, and the codec that turns it into wire bytes.

mod codec;

pub use codec::{decode_packet, encode_message, validate_address};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// One OSC argument. The `type` tag is the OSC 1.0/1.1 typetag character, so what the user
/// picks in the UI is exactly what appears in the typetag string on the wire.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", content = "value")]
#[ts(export)]
pub enum OscArg {
    #[serde(rename = "i")]
    Int(i32),
    #[serde(rename = "f")]
    Float(f32),
    #[serde(rename = "s")]
    String(String),
    #[serde(rename = "b")]
    Blob(Vec<u8>),
    #[serde(rename = "h")]
    Long(i64),
    #[serde(rename = "d")]
    Double(f64),
    #[serde(rename = "c")]
    Char(char),
    /// RGBA colour packed as 0xRRGGBBAA.
    #[serde(rename = "r")]
    Color(u32),
    /// MIDI message: [port, status, data1, data2].
    #[serde(rename = "m")]
    Midi([u8; 4]),
    #[serde(rename = "t")]
    Time(OscTimeTag),
    #[serde(rename = "T")]
    True,
    #[serde(rename = "F")]
    False,
    #[serde(rename = "N")]
    Nil,
    #[serde(rename = "I")]
    Inf,
    /// `[` ... `]` array.
    #[serde(rename = "[")]
    Array(Vec<OscArg>),
}

/// NTP-style time tag (seconds since 1900 + 2^-32 fractions).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct OscTimeTag {
    pub seconds: u32,
    pub fractional: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct OscMessage {
    pub address: String,
    pub args: Vec<OscArg>,
}

/// A decoded packet, as shown in the debug view.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum OscPacketView {
    Message {
        address: String,
        /// Typetag string exactly as encoded, e.g. ",fi".
        typetags: String,
        args: Vec<OscArg>,
    },
    Bundle {
        timetag: OscTimeTag,
        content: Vec<OscPacketView>,
    },
}

impl OscArg {
    /// The typetag character(s) this argument encodes to.
    pub fn typetag(&self) -> String {
        match self {
            OscArg::Int(_) => "i".into(),
            OscArg::Float(_) => "f".into(),
            OscArg::String(_) => "s".into(),
            OscArg::Blob(_) => "b".into(),
            OscArg::Long(_) => "h".into(),
            OscArg::Double(_) => "d".into(),
            OscArg::Char(_) => "c".into(),
            OscArg::Color(_) => "r".into(),
            OscArg::Midi(_) => "m".into(),
            OscArg::Time(_) => "t".into(),
            OscArg::True => "T".into(),
            OscArg::False => "F".into(),
            OscArg::Nil => "N".into(),
            OscArg::Inf => "I".into(),
            OscArg::Array(items) => {
                let inner: String = items.iter().map(OscArg::typetag).collect();
                format!("[{inner}]")
            }
        }
    }
}
