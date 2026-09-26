//! The secure channel between two apps.
//!
//! 1. Both sides send a plaintext **preamble**: magic, protocol version, and a hash of the
//!    session name. A different app, protocol major or session is turned away before any
//!    crypto, with a clear reason. Both preambles are also the Noise prologue, so they can't
//!    be tampered with (no downgrades).
//! 2. A **Noise XXpsk3 handshake** authenticates both devices (static keys) and the session
//!    (the PSK is mixed in only after the DH secrets, so a recorded handshake can't be used to
//!    guess the passphrase offline).
//! 3. After that, every message is encrypted. Frames are length-prefixed (net/framing.rs), at
//!    most one Noise message (65535 bytes) each, and any framing error ends the connection.
//!    Larger messages are split into chunks: the first chunk starts with the total length.

use std::collections::VecDeque;
use std::sync::Arc;

use snow::StatelessTransportState;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use super::identity::{Identity, NOISE_PARAMS};
use super::wire::{MAX_MESSAGE, PROTOCOL};
use crate::net::framing::{encode_frame, FrameDecoder};
use crate::net::TcpFraming;

const MAGIC: &[u8; 8] = b"OCTOSYNC";
pub const PREAMBLE_LEN: usize = 20;
/// The largest Noise message.
pub const NOISE_MAX: usize = 65_535;
const TAG: usize = 16;
const CHUNK: usize = NOISE_MAX - TAG;

pub fn preamble(session_hash: &[u8; 8]) -> [u8; PREAMBLE_LEN] {
    let mut out = [0u8; PREAMBLE_LEN];
    out[..8].copy_from_slice(MAGIC);
    out[8..10].copy_from_slice(&PROTOCOL.0.to_be_bytes());
    out[10..12].copy_from_slice(&PROTOCOL.1.to_be_bytes());
    out[12..20].copy_from_slice(session_hash);
    out
}

/// Why a peer's preamble is refused, in words for the UI.
pub fn check_preamble(ours: &[u8; PREAMBLE_LEN], theirs: &[u8]) -> Result<(), String> {
    if theirs.len() != PREAMBLE_LEN || &theirs[..8] != MAGIC {
        return Err("not an OscOctopus sync connection".into());
    }
    let major = u16::from_be_bytes([theirs[8], theirs[9]]);
    if major != PROTOCOL.0 {
        return Err(format!(
            "incompatible sync protocol (theirs v{major}, ours v{}): update OscOctopus on the older device",
            PROTOCOL.0
        ));
    }
    if theirs[12..20] != ours[12..20] {
        return Err("different session name".into());
    }
    Ok(())
}

/// Reads length-prefixed frames of at most one Noise message each.
pub struct FrameReader<R> {
    inner: R,
    decoder: FrameDecoder,
    ready: VecDeque<Vec<u8>>,
    buf: Vec<u8>,
}

impl<R: AsyncRead + Unpin> FrameReader<R> {
    pub fn new(inner: R) -> Self {
        Self {
            inner,
            decoder: FrameDecoder::new(TcpFraming::LengthPrefix),
            ready: VecDeque::new(),
            buf: vec![0u8; 16 * 1024],
        }
    }

    /// Reads exactly `n` raw bytes (the preamble, before framing starts).
    pub async fn read_exact_raw(&mut self, n: usize) -> Result<Vec<u8>, String> {
        let mut out = vec![0u8; n];
        self.inner
            .read_exact(&mut out)
            .await
            .map_err(|e| format!("connection closed during setup ({e})"))?;
        Ok(out)
    }

    /// The next frame. Any framing error, or a frame larger than a Noise message, is fatal.
    pub async fn next(&mut self) -> Result<Vec<u8>, String> {
        loop {
            if let Some(frame) = self.ready.pop_front() {
                if frame.len() > NOISE_MAX {
                    return Err(format!(
                        "frame of {} bytes exceeds {NOISE_MAX}",
                        frame.len()
                    ));
                }
                return Ok(frame);
            }
            let n = self
                .inner
                .read(&mut self.buf)
                .await
                .map_err(|e| e.to_string())?;
            if n == 0 {
                return Err("closed by peer".into());
            }
            for frame in self.decoder.feed(&self.buf[..n]) {
                self.ready
                    .push_back(frame.map_err(|e| format!("bad frame: {e}"))?);
            }
        }
    }
}

pub async fn write_frame<W: AsyncWrite + Unpin>(
    writer: &mut W,
    bytes: &[u8],
) -> std::io::Result<()> {
    writer
        .write_all(&encode_frame(TcpFraming::LengthPrefix, bytes))
        .await
}

/// An authenticated, encrypted channel after the handshake.
pub struct Channel {
    pub transport: Arc<StatelessTransportState>,
    /// The peer's Noise static public key (its identity).
    pub remote_static: Vec<u8>,
}

fn noise_err(e: snow::Error) -> String {
    format!("{e:?}")
}

/// Runs the XXpsk3 handshake. `initiator` is the side that connected.
pub async fn handshake<R, W>(
    reader: &mut FrameReader<R>,
    writer: &mut W,
    initiator: bool,
    identity: &Identity,
    psk: &[u8; 32],
    prologue: &[u8],
) -> Result<Channel, String>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let builder = snow::Builder::new(NOISE_PARAMS.parse().map_err(noise_err)?)
        .local_private_key(identity.private())
        .map_err(noise_err)?
        .psk(3, psk)
        .map_err(noise_err)?
        .prologue(prologue)
        .map_err(noise_err)?;
    let mut hs = if initiator {
        builder.build_initiator()
    } else {
        builder.build_responder()
    }
    .map_err(noise_err)?;
    let mut buf = vec![0u8; NOISE_MAX];
    let write = |hs: &mut snow::HandshakeState, buf: &mut Vec<u8>| -> Result<Vec<u8>, String> {
        let n = hs.write_message(&[], buf).map_err(noise_err)?;
        Ok(buf[..n].to_vec())
    };
    // -> e   <- e, ee, s, es   -> s, se, psk
    if initiator {
        let m1 = write(&mut hs, &mut buf)?;
        write_frame(writer, &m1).await.map_err(|e| e.to_string())?;
        let m2 = reader.next().await?;
        hs.read_message(&m2, &mut buf).map_err(noise_err)?;
        let m3 = write(&mut hs, &mut buf)?;
        write_frame(writer, &m3).await.map_err(|e| e.to_string())?;
    } else {
        let m1 = reader.next().await?;
        hs.read_message(&m1, &mut buf).map_err(noise_err)?;
        let m2 = write(&mut hs, &mut buf)?;
        write_frame(writer, &m2).await.map_err(|e| e.to_string())?;
        let m3 = reader.next().await?;
        // A wrong session key shows up here: the last message doesn't decrypt.
        hs.read_message(&m3, &mut buf)
            .map_err(|_| "wrong session key".to_string())?;
    }
    let remote_static = hs.get_remote_static().ok_or("no remote identity")?.to_vec();
    let transport = hs.into_stateless_transport_mode().map_err(noise_err)?;
    Ok(Channel {
        transport: Arc::new(transport),
        remote_static,
    })
}

/// Encrypts outgoing messages (one per call), splitting large ones into chunks.
pub struct Sealer {
    transport: Arc<StatelessTransportState>,
    nonce: u64,
}

impl Sealer {
    pub fn new(transport: Arc<StatelessTransportState>) -> Self {
        Self {
            transport,
            nonce: 0,
        }
    }

    /// The frames that carry `message`.
    pub fn seal(&mut self, message: &[u8]) -> Result<Vec<Vec<u8>>, String> {
        if message.len() > MAX_MESSAGE {
            return Err(format!(
                "message of {} bytes exceeds {MAX_MESSAGE}",
                message.len()
            ));
        }
        let mut plain = Vec::with_capacity(4 + message.len());
        plain.extend_from_slice(&(message.len() as u32).to_be_bytes());
        plain.extend_from_slice(message);
        let mut buf = vec![0u8; NOISE_MAX];
        plain
            .chunks(CHUNK)
            .map(|chunk| {
                let n = self
                    .transport
                    .write_message(self.nonce, chunk, &mut buf)
                    .map_err(noise_err)?;
                self.nonce += 1;
                Ok(buf[..n].to_vec())
            })
            .collect()
    }
}

/// Decrypts incoming frames and reassembles messages.
pub struct Opener {
    transport: Arc<StatelessTransportState>,
    nonce: u64,
    partial: Option<(usize, Vec<u8>)>,
    buf: Vec<u8>,
}

impl Opener {
    pub fn new(transport: Arc<StatelessTransportState>) -> Self {
        Self {
            transport,
            nonce: 0,
            partial: None,
            buf: vec![0u8; NOISE_MAX],
        }
    }

    /// Opens one frame; returns a message once all its chunks arrived. Errors are fatal.
    pub fn open(&mut self, frame: &[u8]) -> Result<Option<Vec<u8>>, String> {
        let n = self
            .transport
            .read_message(self.nonce, frame, &mut self.buf)
            .map_err(|_| "message failed to decrypt (tampered or out of order)".to_string())?;
        self.nonce += 1;
        let plain = &self.buf[..n];
        let (total, acc) = match self.partial.take() {
            Some((total, mut acc)) => {
                acc.extend_from_slice(plain);
                (total, acc)
            }
            None => {
                let Some(len) = plain.get(..4) else {
                    return Err("message without a length".into());
                };
                let total = u32::from_be_bytes(len.try_into().unwrap()) as usize;
                if total > MAX_MESSAGE {
                    return Err(format!("message of {total} bytes exceeds {MAX_MESSAGE}"));
                }
                let mut acc = Vec::with_capacity(total);
                acc.extend_from_slice(&plain[4..]);
                (total, acc)
            }
        };
        if acc.len() > total {
            return Err("message longer than announced".into());
        }
        if acc.len() == total {
            Ok(Some(acc))
        } else {
            self.partial = Some((total, acc));
            Ok(None)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::duplex;

    /// Handshakes an initiator holding PSK [7; 32] with a responder holding `psk_b`.
    async fn pair(psk_b: [u8; 32]) -> (Result<Channel, String>, Result<Channel, String>) {
        let (a, b) = duplex(1 << 20);
        let (ar, mut aw) = tokio::io::split(a);
        let (br, mut bw) = tokio::io::split(b);
        let (ia, ib) = (Identity::generate(), Identity::generate());
        let ta = tokio::spawn(async move {
            let mut r = FrameReader::new(ar);
            handshake(&mut r, &mut aw, true, &ia, &[7u8; 32], b"prologue").await
        });
        let tb = tokio::spawn(async move {
            let mut r = FrameReader::new(br);
            handshake(&mut r, &mut bw, false, &ib, &psk_b, b"prologue").await
        });
        (ta.await.unwrap(), tb.await.unwrap())
    }

    #[tokio::test]
    async fn handshake_authenticates_and_encrypts_both_ways() {
        let (a, b) = pair([7u8; 32]).await;
        let (a, b) = (a.unwrap(), b.unwrap());
        let mut sealer = Sealer::new(a.transport.clone());
        let mut opener = Opener::new(b.transport.clone());
        // Small, and larger than one Noise message (chunked).
        for msg in [b"hello".to_vec(), vec![42u8; 3 * NOISE_MAX + 17]] {
            let frames = sealer.seal(&msg).unwrap();
            let mut out = None;
            for f in &frames {
                assert!(f.len() <= NOISE_MAX);
                out = opener.open(f).unwrap();
            }
            assert_eq!(out.unwrap(), msg);
        }
    }

    #[tokio::test]
    async fn a_wrong_session_key_fails_the_handshake() {
        let (_, b) = pair([8u8; 32]).await;
        assert_eq!(b.err().unwrap(), "wrong session key");
    }

    #[tokio::test]
    async fn tampered_or_replayed_frames_are_fatal() {
        let (a, b) = pair([7u8; 32]).await;
        let (a, b) = (a.unwrap(), b.unwrap());
        let mut sealer = Sealer::new(a.transport.clone());
        let mut opener = Opener::new(b.transport.clone());
        let mut frame = sealer.seal(b"x").unwrap().remove(0);
        frame[3] ^= 1;
        assert!(opener.open(&frame).is_err(), "tampered");
        let mut opener = Opener::new(b.transport);
        let first = sealer.seal(b"y").unwrap().remove(0);
        let _ = opener.open(&first);
        assert!(opener.open(&first).is_err(), "replayed");
    }

    #[test]
    fn preamble_tells_sessions_and_versions_apart() {
        let ours = preamble(&[1; 8]);
        assert!(check_preamble(&ours, &preamble(&[1; 8])).is_ok());
        assert_eq!(
            check_preamble(&ours, &preamble(&[2; 8])).unwrap_err(),
            "different session name"
        );
        let mut newer = preamble(&[1; 8]);
        newer[8..10].copy_from_slice(&(PROTOCOL.0 + 1).to_be_bytes());
        assert!(check_preamble(&ours, &newer)
            .unwrap_err()
            .contains("incompatible"));
        assert!(check_preamble(&ours, b"GET / HTTP/1.1\r\nHost:").is_err());
    }
}
