//! TCP stream framing for OSC: SLIP (OSC 1.1) and int32 length prefix (OSC 1.0).

use super::TcpFraming;

const END: u8 = 0xC0;
const ESC: u8 = 0xDB;
const ESC_END: u8 = 0xDC;
const ESC_ESC: u8 = 0xDD;

/// Largest packet accepted from a stream; protects against unbounded buffering.
pub const MAX_FRAME: usize = 1 << 20;

pub fn encode_frame(framing: TcpFraming, packet: &[u8]) -> Vec<u8> {
    match framing {
        TcpFraming::Slip => {
            let mut out = Vec::with_capacity(packet.len() + 8);
            out.push(END);
            for &b in packet {
                match b {
                    END => out.extend_from_slice(&[ESC, ESC_END]),
                    ESC => out.extend_from_slice(&[ESC, ESC_ESC]),
                    b => out.push(b),
                }
            }
            out.push(END);
            out
        }
        TcpFraming::LengthPrefix => {
            let mut out = Vec::with_capacity(packet.len() + 4);
            out.extend_from_slice(&(packet.len() as u32).to_be_bytes());
            out.extend_from_slice(packet);
            out
        }
    }
}

/// Incremental decoder: feed it whatever the socket returned, get back complete packets.
pub struct FrameDecoder {
    framing: TcpFraming,
    buf: Vec<u8>,
    escape: bool,
    /// SLIP: current frame is invalid and is being skipped until the next END.
    discard: bool,
}

impl FrameDecoder {
    pub fn new(framing: TcpFraming) -> Self {
        Self {
            framing,
            buf: Vec::new(),
            escape: false,
            discard: false,
        }
    }

    pub fn feed(&mut self, data: &[u8]) -> Vec<Result<Vec<u8>, String>> {
        match self.framing {
            TcpFraming::Slip => self.feed_slip(data),
            TcpFraming::LengthPrefix => self.feed_length_prefix(data),
        }
    }

    fn feed_slip(&mut self, data: &[u8]) -> Vec<Result<Vec<u8>, String>> {
        let mut out = Vec::new();
        for &b in data {
            if b == END {
                if !self.discard && !self.buf.is_empty() {
                    out.push(Ok(std::mem::take(&mut self.buf)));
                }
                self.buf.clear();
                self.escape = false;
                self.discard = false;
                continue;
            }
            if self.discard {
                continue;
            }
            let byte = if self.escape {
                self.escape = false;
                match b {
                    ESC_END => END,
                    ESC_ESC => ESC,
                    other => {
                        out.push(Err(format!(
                            "invalid SLIP escape 0xDB 0x{other:02X}; frame discarded"
                        )));
                        self.discard = true;
                        continue;
                    }
                }
            } else if b == ESC {
                self.escape = true;
                continue;
            } else {
                b
            };
            if self.buf.len() >= MAX_FRAME {
                out.push(Err(format!(
                    "SLIP frame exceeds {MAX_FRAME} bytes; frame discarded"
                )));
                self.buf.clear();
                self.discard = true;
                continue;
            }
            self.buf.push(byte);
        }
        out
    }

    fn feed_length_prefix(&mut self, data: &[u8]) -> Vec<Result<Vec<u8>, String>> {
        let mut out = Vec::new();
        self.buf.extend_from_slice(data);
        while let Some(header) = self.buf.get(..4) {
            let len = u32::from_be_bytes(header.try_into().unwrap()) as usize;
            if len > MAX_FRAME {
                // The stream is desynchronised; there is no way to find the next boundary.
                out.push(Err(format!(
                    "length prefix {len} exceeds {MAX_FRAME} bytes; stream buffer discarded"
                )));
                self.buf.clear();
                break;
            }
            if self.buf.len() < 4 + len {
                break;
            }
            let packet = self.buf[4..4 + len].to_vec();
            self.buf.drain(..4 + len);
            out.push(Ok(packet));
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(frames: Vec<Result<Vec<u8>, String>>) -> Vec<Vec<u8>> {
        frames.into_iter().map(Result::unwrap).collect()
    }

    #[test]
    fn slip_escapes_special_bytes() {
        let packet = [1, END, 2, ESC, 3];
        let framed = encode_frame(TcpFraming::Slip, &packet);
        assert_eq!(framed, [END, 1, ESC, ESC_END, 2, ESC, ESC_ESC, 3, END]);
        let mut dec = FrameDecoder::new(TcpFraming::Slip);
        assert_eq!(ok(dec.feed(&framed)), [packet.to_vec()]);
    }

    #[test]
    fn slip_handles_split_reads_and_back_to_back_frames() {
        let mut stream = encode_frame(TcpFraming::Slip, b"abc");
        stream.extend(encode_frame(TcpFraming::Slip, &[ESC, END]));
        let mut dec = FrameDecoder::new(TcpFraming::Slip);
        let mut frames = Vec::new();
        for chunk in stream.chunks(1) {
            frames.extend(ok(dec.feed(chunk)));
        }
        assert_eq!(frames, [b"abc".to_vec(), vec![ESC, END]]);
    }

    #[test]
    fn slip_reports_bad_escape_and_recovers() {
        let mut dec = FrameDecoder::new(TcpFraming::Slip);
        let frames = dec.feed(&[END, 1, ESC, 0x00, 2, END, 7, END]);
        assert!(frames[0].is_err());
        assert_eq!(frames[1], Ok(vec![7]));
        assert_eq!(frames.len(), 2);
    }

    #[test]
    fn length_prefix_round_trip_with_partial_reads() {
        let mut stream = encode_frame(TcpFraming::LengthPrefix, b"hello");
        stream.extend(encode_frame(TcpFraming::LengthPrefix, b""));
        stream.extend(encode_frame(TcpFraming::LengthPrefix, b"xy"));
        let mut dec = FrameDecoder::new(TcpFraming::LengthPrefix);
        let (a, b) = stream.split_at(6);
        let mut frames = ok(dec.feed(a));
        frames.extend(ok(dec.feed(b)));
        assert_eq!(frames, [b"hello".to_vec(), vec![], b"xy".to_vec()]);
    }

    #[test]
    fn length_prefix_rejects_oversized() {
        let mut dec = FrameDecoder::new(TcpFraming::LengthPrefix);
        let frames = dec.feed(&u32::MAX.to_be_bytes());
        assert!(frames[0].is_err());
    }
}
