use rosc::{OscColor, OscMidiMessage, OscPacket, OscTime, OscType};

use super::{OscArg, OscMessage, OscPacketView, OscTimeTag};
use crate::error::{AppError, AppResult};

/// Rejects addresses that would produce a malformed packet. Pattern characters (`* ? [ ] { }`)
/// are allowed because senders may legitimately address patterns.
pub fn validate_address(address: &str) -> AppResult<()> {
    let fail = |reason| {
        Err(AppError::InvalidAddress {
            address: address.to_string(),
            reason,
        })
    };
    if !address.starts_with('/') {
        return fail("must start with '/'");
    }
    for c in address.chars() {
        if !c.is_ascii_graphic() {
            return fail("only printable ASCII without spaces is allowed");
        }
        if c == '#' || c == ',' {
            return fail("'#' and ',' are reserved");
        }
    }
    Ok(())
}

/// Encodes a single message to raw OSC bytes (no transport framing).
pub fn encode_message(msg: &OscMessage) -> AppResult<Vec<u8>> {
    validate_address(&msg.address)?;
    let packet = OscPacket::Message(rosc::OscMessage {
        addr: msg.address.clone(),
        args: msg.args.iter().map(to_rosc).collect(),
    });
    rosc::encoder::encode(&packet).map_err(|e| AppError::OscEncode(format!("{e:?}")))
}

/// Decodes raw OSC bytes (one UDP datagram or one de-framed TCP packet).
pub fn decode_packet(bytes: &[u8]) -> Result<OscPacketView, String> {
    match rosc::decoder::decode_udp(bytes) {
        Ok(([], packet)) => Ok(view(&packet)),
        Ok((rest, _)) => Err(format!("{} trailing byte(s) after packet", rest.len())),
        Err(e) => Err(format!("{e:?}")),
    }
}

fn view(packet: &OscPacket) -> OscPacketView {
    match packet {
        OscPacket::Message(m) => {
            let args: Vec<OscArg> = m.args.iter().map(from_rosc).collect();
            let typetags = std::iter::once(",".to_string())
                .chain(args.iter().map(OscArg::typetag))
                .collect();
            OscPacketView::Message {
                address: m.addr.clone(),
                typetags,
                args,
            }
        }
        OscPacket::Bundle(b) => OscPacketView::Bundle {
            timetag: OscTimeTag {
                seconds: b.timetag.seconds,
                fractional: b.timetag.fractional,
            },
            content: b.content.iter().map(view).collect(),
        },
    }
}

fn to_rosc(arg: &OscArg) -> OscType {
    match arg {
        OscArg::Int(v) => OscType::Int(*v),
        OscArg::Float(v) => OscType::Float(*v),
        OscArg::String(v) => OscType::String(v.clone()),
        OscArg::Blob(v) => OscType::Blob(v.clone()),
        OscArg::Long(v) => OscType::Long(*v),
        OscArg::Double(v) => OscType::Double(*v),
        OscArg::Char(v) => OscType::Char(*v),
        OscArg::Color(v) => {
            let [red, green, blue, alpha] = v.to_be_bytes();
            OscType::Color(OscColor {
                red,
                green,
                blue,
                alpha,
            })
        }
        OscArg::Midi([port, status, data1, data2]) => OscType::Midi(OscMidiMessage {
            port: *port,
            status: *status,
            data1: *data1,
            data2: *data2,
        }),
        OscArg::Time(t) => OscType::Time(OscTime {
            seconds: t.seconds,
            fractional: t.fractional,
        }),
        OscArg::True => OscType::Bool(true),
        OscArg::False => OscType::Bool(false),
        OscArg::Nil => OscType::Nil,
        OscArg::Inf => OscType::Inf,
        OscArg::Array(items) => OscType::Array(items.iter().map(to_rosc).collect()),
    }
}

fn from_rosc(arg: &OscType) -> OscArg {
    match arg {
        OscType::Int(v) => OscArg::Int(*v),
        OscType::Float(v) => OscArg::Float(*v),
        OscType::String(v) => OscArg::String(v.clone()),
        OscType::Blob(v) => OscArg::Blob(v.clone()),
        OscType::Long(v) => OscArg::Long(*v),
        OscType::Double(v) => OscArg::Double(*v),
        OscType::Char(v) => OscArg::Char(*v),
        OscType::Color(c) => OscArg::Color(u32::from_be_bytes([c.red, c.green, c.blue, c.alpha])),
        OscType::Midi(m) => OscArg::Midi([m.port, m.status, m.data1, m.data2]),
        OscType::Time(t) => OscArg::Time(OscTimeTag {
            seconds: t.seconds,
            fractional: t.fractional,
        }),
        OscType::Bool(true) => OscArg::True,
        OscType::Bool(false) => OscArg::False,
        OscType::Nil => OscArg::Nil,
        OscType::Inf => OscArg::Inf,
        OscType::Array(a) => OscArg::Array(a.content.iter().map(from_rosc).collect()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(address: &str, args: Vec<OscArg>) -> OscMessage {
        OscMessage {
            address: address.into(),
            args,
        }
    }

    #[test]
    fn encodes_known_bytes() {
        // "/a\0\0" ",f\0\0" 1.0f32 big-endian
        let bytes = encode_message(&msg("/a", vec![OscArg::Float(1.0)])).unwrap();
        assert_eq!(
            bytes,
            [b'/', b'a', 0, 0, b',', b'f', 0, 0, 0x3f, 0x80, 0x00, 0x00]
        );
    }

    #[test]
    fn round_trips_every_arg_type() {
        let args = vec![
            OscArg::Int(-7),
            OscArg::Float(0.25),
            OscArg::String("hello".into()),
            OscArg::Blob(vec![1, 2, 3]),
            OscArg::Long(1 << 40),
            OscArg::Double(3.5),
            OscArg::Char('x'),
            OscArg::Color(0x11223344),
            OscArg::Midi([0, 0x90, 60, 127]),
            OscArg::Time(OscTimeTag {
                seconds: 1,
                fractional: 2,
            }),
            OscArg::True,
            OscArg::False,
            OscArg::Nil,
            OscArg::Inf,
            OscArg::Array(vec![OscArg::Int(1), OscArg::String("a".into())]),
        ];
        let bytes = encode_message(&msg("/mixer/ch/1", args.clone())).unwrap();
        match decode_packet(&bytes).unwrap() {
            OscPacketView::Message {
                address,
                typetags,
                args: decoded,
            } => {
                assert_eq!(address, "/mixer/ch/1");
                assert_eq!(typetags, ",ifsbhdcrmtTFNI[is]");
                assert_eq!(decoded, args);
            }
            other => panic!("expected message, got {other:?}"),
        }
    }

    #[test]
    fn rejects_bad_addresses() {
        assert!(validate_address("no/slash").is_err());
        assert!(validate_address("/has space").is_err());
        assert!(validate_address("/bundle#").is_err());
        assert!(validate_address("/ok/*/pattern").is_ok());
    }

    #[test]
    fn reports_garbage_instead_of_panicking() {
        assert!(decode_packet(&[0xff, 0x00, 0x12]).is_err());
    }
}
