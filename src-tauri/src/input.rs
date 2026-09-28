//! Inbound OSC for input mapping. Rust only does the transport jobs here:
//! - a master gate (off until the UI turns it on);
//! - a filter to the endpoints a widget listens on;
//! - recognising packets this app (or a sync peer app) sent itself;
//! - flattening bundles;
//! - a bounded queue flushed to the UI at ~60 Hz.
//!
//! Which widget a message drives is decided in the frontend (`src/lib/osc/receiver.svelte.ts`).
//! That is where the widget definitions live.

use std::collections::{HashMap, HashSet, VecDeque};
use std::net::{IpAddr, SocketAddr};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock, Weak};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::debug::now_micros;
use crate::osc::{OscArg, OscPacketView};

/// Where an inbound packet came from, when it isn't the outside world. Such packets are shown
/// in TRAFFIC but never drive a widget.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub enum Origin {
    /// One of this app's own output sockets (e.g. an output aimed at this app's own input).
    #[serde(rename = "self")]
    App,
    /// A sync peer's OSC output: that app already drives the widget for everyone.
    #[serde(rename = "peer")]
    Peer,
}

/// One OSC message that arrived on an endpoint somebody listens to.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct InboundMessage {
    /// The DebugEvent it was recorded as, so TRAFFIC can show what input mapping did with it.
    /// Every message of one bundle shares it.
    pub seq: u64,
    /// When it arrived: wall-clock microseconds since the Unix epoch.
    pub ts_micros: u64,
    pub desk: String,
    pub endpoint_id: String,
    pub remote: String,
    pub address: String,
    pub args: Vec<OscArg>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct InputBatch {
    pub messages: Vec<InboundMessage>,
    /// Messages discarded since the previous batch because the queue was full (a flood).
    pub dropped: u64,
    pub total_dropped: u64,
}

/// Where a forwarded message must not go: back to the input's sender.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct Avoid {
    /// The endpoint the input arrived on; if it is an output (replies), that output is skipped.
    pub endpoint_id: Option<String>,
    /// The sender's address, e.g. "192.168.1.30:8000".
    pub remote: Option<String>,
}

/// Nested bundles are flattened up to this depth.
pub const MAX_BUNDLE_DEPTH: usize = 8;
/// At most this many messages are taken from one packet.
pub const MAX_MESSAGES_PER_PACKET: usize = 256;
/// Queue size between flushes; beyond it the oldest messages are dropped (and counted).
pub const INPUT_QUEUE_CAP: usize = 1024;
/// How often the interface list may be re-read when an unknown IP shows up.
const OWN_IPS_REFRESH: Duration = Duration::from_secs(2);

fn canon(a: SocketAddr) -> SocketAddr {
    SocketAddr::new(a.ip().to_canonical(), a.port())
}

fn local_ips() -> HashSet<IpAddr> {
    if_addrs::get_if_addrs()
        .map(|ifs| ifs.iter().map(|i| i.ip().to_canonical()).collect())
        .unwrap_or_default()
}

#[derive(Default)]
struct OwnSockets {
    /// Local addresses of output sockets bound to one IP (with a count, several may share).
    exact: HashMap<SocketAddr, usize>,
    /// Ports of output sockets bound to 0.0.0.0 / :: (they send from any local IP).
    any_ip: HashMap<u16, usize>,
    /// This machine's interface addresses, refreshed lazily.
    own_ips: HashSet<IpAddr>,
    refreshed: Option<Instant>,
    /// Sync peers' OSC output sockets on other machines.
    peers: HashSet<SocketAddr>,
    /// Ports of sync peers' OSC outputs on this machine (they send from any local IP).
    local_peer_ports: HashSet<u16>,
}

struct Pending {
    queue: VecDeque<InboundMessage>,
    dropped: u64,
    total_dropped: u64,
}

pub struct InputHub {
    enabled: AtomicBool,
    /// desk → endpoint ids a widget listens on.
    listen: RwLock<HashMap<String, HashSet<String>>>,
    own: RwLock<OwnSockets>,
    pending: Mutex<Pending>,
    cap: usize,
}

/// Keeps an output socket's address registered as this app's own; unregisters it when dropped
/// (also when the task that owns it is aborted), so the registry can't go stale.
pub struct OwnSocketGuard {
    hub: Weak<InputHub>,
    addr: SocketAddr,
}

impl Drop for OwnSocketGuard {
    fn drop(&mut self) {
        if let Some(hub) = self.hub.upgrade() {
            hub.unregister_own(self.addr);
        }
    }
}

impl InputHub {
    pub fn new(cap: usize) -> Self {
        Self {
            enabled: AtomicBool::new(false),
            listen: RwLock::default(),
            own: RwLock::default(),
            pending: Mutex::new(Pending {
                queue: VecDeque::new(),
                dropped: 0,
                total_dropped: 0,
            }),
            cap,
        }
    }

    /// The master gate. Returns the new state.
    pub fn set_enabled(&self, enabled: bool) -> bool {
        self.enabled.store(enabled, Ordering::SeqCst);
        enabled
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::SeqCst)
    }

    /// The endpoints of `desk` a widget listens on (replaces the previous set).
    pub fn set_listen(&self, desk: &str, endpoint_ids: Vec<String>) {
        let mut listen = self.listen.write().unwrap();
        if endpoint_ids.is_empty() {
            listen.remove(desk);
        } else {
            listen.insert(desk.to_string(), endpoint_ids.into_iter().collect());
        }
    }

    pub fn forget_desk(&self, desk: &str) {
        self.listen.write().unwrap().remove(desk);
    }

    /// Whether a message on this endpoint goes to the UI.
    pub fn accepts(&self, desk: &str, endpoint_id: &str) -> bool {
        self.is_enabled()
            && self
                .listen
                .read()
                .unwrap()
                .get(desk)
                .is_some_and(|ids| ids.contains(endpoint_id))
    }

    pub(crate) fn register_own(self: &Arc<Self>, addr: SocketAddr) -> OwnSocketGuard {
        let addr = canon(addr);
        let mut own = self.own.write().unwrap();
        if addr.ip().is_unspecified() {
            *own.any_ip.entry(addr.port()).or_default() += 1;
        } else {
            *own.exact.entry(addr).or_default() += 1;
        }
        OwnSocketGuard {
            hub: Arc::downgrade(self),
            addr,
        }
    }

    fn unregister_own(&self, addr: SocketAddr) {
        let mut own = self.own.write().unwrap();
        if addr.ip().is_unspecified() {
            release(&mut own.any_ip, &addr.port());
        } else {
            release(&mut own.exact, &addr);
        }
    }

    /// The local ports of this app's output sockets, for sync peers to recognise its packets.
    pub fn own_ports(&self) -> Vec<u16> {
        let own = self.own.read().unwrap();
        let ports: std::collections::BTreeSet<u16> = own
            .exact
            .keys()
            .map(|a| a.port())
            .chain(own.any_ip.keys().copied())
            .collect();
        ports.into_iter().collect()
    }

    /// Replaces the set of sync peers' OSC output addresses. A peer on this machine (loopback
    /// or one of this machine's IPs) is recognised by its port on any local IP.
    pub fn set_peer_outputs(&self, addrs: impl IntoIterator<Item = SocketAddr>) {
        let ips = local_ips();
        let mut own = self.own.write().unwrap();
        own.own_ips = ips;
        own.refreshed = Some(Instant::now());
        let (mut peers, mut local_ports) = (HashSet::new(), HashSet::new());
        for addr in addrs.into_iter().map(canon) {
            let ip = addr.ip();
            if ip.is_loopback() || ip.is_unspecified() || own.own_ips.contains(&ip) {
                local_ports.insert(addr.port());
            } else {
                peers.insert(addr);
            }
        }
        own.peers = peers;
        own.local_peer_ports = local_ports;
    }

    /// Whether `remote` is one of this app's output sockets, or a sync peer's.
    pub fn origin(&self, remote: SocketAddr) -> Option<Origin> {
        let remote = canon(remote);
        {
            let own = self.own.read().unwrap();
            let local = remote.ip().is_loopback() || own.own_ips.contains(&remote.ip());
            if own.peers.contains(&remote)
                || (local && own.local_peer_ports.contains(&remote.port()))
            {
                return Some(Origin::Peer);
            }
            if own.exact.contains_key(&remote) {
                return Some(Origin::App);
            }
            if !own.any_ip.contains_key(&remote.port()) {
                return None;
            }
            if local {
                return Some(Origin::App);
            }
            if own.refreshed.is_some_and(|t| t.elapsed() < OWN_IPS_REFRESH) {
                return None;
            }
        }
        // An unknown IP on the port of one of our 0.0.0.0 outputs: the interface list may be
        // stale (DHCP, VPN). Re-read it, at most every OWN_IPS_REFRESH, and look again.
        let ips = local_ips();
        let mut own = self.own.write().unwrap();
        own.own_ips = ips;
        own.refreshed = Some(Instant::now());
        own.own_ips.contains(&remote.ip()).then_some(Origin::App)
    }

    fn is_local_ip(&self, ip: IpAddr) -> bool {
        ip.is_loopback() || self.own.read().unwrap().own_ips.contains(&ip)
    }

    /// Whether sending to `target` would go back to `origin`, the sender of an input. A sender
    /// on another machine is avoided by IP, on any port, since many devices reply from a
    /// different port than they listen on. A sender on this machine is only avoided by its
    /// exact port, so two apps on one computer can still bridge each other.
    pub fn is_origin(&self, target: SocketAddr, origin: SocketAddr) -> bool {
        let (target, origin) = (canon(target), canon(origin));
        if self.is_local_ip(origin.ip()) {
            target.port() == origin.port()
                && (target.ip() == origin.ip() || self.is_local_ip(target.ip()))
        } else {
            target.ip() == origin.ip()
        }
    }

    /// Queues every message of a packet (bundles flattened, in order) under one lock, so a
    /// bundle arrives in one batch.
    pub(crate) fn offer(
        &self,
        seq: u64,
        desk: &str,
        endpoint_id: &str,
        remote: SocketAddr,
        view: &OscPacketView,
    ) {
        let mut messages = Vec::new();
        flatten(view, 0, &mut messages);
        let remote = canon(remote).to_string();
        let ts_micros = now_micros();
        let mut pending = self.pending.lock().unwrap();
        for (address, args) in messages {
            pending.queue.push_back(InboundMessage {
                seq,
                ts_micros,
                desk: desk.to_string(),
                endpoint_id: endpoint_id.to_string(),
                remote: remote.clone(),
                address: address.to_string(),
                args: args.to_vec(),
            });
            if pending.queue.len() > self.cap {
                pending.queue.pop_front();
                pending.dropped += 1;
                pending.total_dropped += 1;
            }
        }
    }

    /// Takes everything queued since the last call; `None` if there is nothing new.
    pub fn drain(&self) -> Option<InputBatch> {
        let mut pending = self.pending.lock().unwrap();
        if pending.queue.is_empty() && pending.dropped == 0 {
            return None;
        }
        let batch = InputBatch {
            messages: pending.queue.drain(..).collect(),
            dropped: pending.dropped,
            total_dropped: pending.total_dropped,
        };
        pending.dropped = 0;
        Some(batch)
    }
}

fn release<K: std::hash::Hash + Eq>(map: &mut HashMap<K, usize>, key: &K) {
    if let Some(n) = map.get_mut(key) {
        *n -= 1;
        if *n == 0 {
            map.remove(key);
        }
    }
}

fn flatten<'a>(view: &'a OscPacketView, depth: usize, out: &mut Vec<(&'a str, &'a [OscArg])>) {
    if out.len() >= MAX_MESSAGES_PER_PACKET {
        return;
    }
    match view {
        OscPacketView::Message { address, args, .. } => out.push((address, args)),
        OscPacketView::Bundle { content, .. } if depth < MAX_BUNDLE_DEPTH => {
            for item in content {
                flatten(item, depth + 1, out);
            }
        }
        OscPacketView::Bundle { .. } => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::osc::OscTimeTag;

    fn msg(address: &str) -> OscPacketView {
        OscPacketView::Message {
            address: address.into(),
            typetags: ",".into(),
            args: vec![],
        }
    }

    fn bundle(content: Vec<OscPacketView>) -> OscPacketView {
        OscPacketView::Bundle {
            timetag: OscTimeTag {
                seconds: 0,
                fractional: 1,
            },
            content,
        }
    }

    fn addr(s: &str) -> SocketAddr {
        s.parse().unwrap()
    }

    fn addresses(batch: &InputBatch) -> Vec<&str> {
        batch.messages.iter().map(|m| m.address.as_str()).collect()
    }

    #[test]
    fn flattens_bundles_in_order_with_a_depth_cap() {
        let hub = InputHub::new(100);
        let nested = bundle(vec![
            msg("/a"),
            bundle(vec![msg("/b"), msg("/c")]),
            msg("/d"),
        ]);
        hub.offer(7, "d", "in", addr("10.0.0.9:1"), &nested);
        let batch = hub.drain().unwrap();
        assert_eq!(addresses(&batch), ["/a", "/b", "/c", "/d"]);
        assert!(batch.messages.iter().all(|m| m.seq == 7));

        let mut deep = msg("/deep");
        for _ in 0..MAX_BUNDLE_DEPTH + 1 {
            deep = bundle(vec![deep]);
        }
        hub.offer(8, "d", "in", addr("10.0.0.9:1"), &deep);
        assert!(hub.drain().is_none(), "too deep: nothing taken");
    }

    #[test]
    fn caps_messages_per_packet_and_the_queue() {
        let hub = InputHub::new(10);
        let many = bundle(
            (0..MAX_MESSAGES_PER_PACKET + 50)
                .map(|_| msg("/x"))
                .collect(),
        );
        hub.offer(1, "d", "in", addr("10.0.0.9:1"), &many);
        let batch = hub.drain().unwrap();
        assert_eq!(batch.messages.len(), 10, "queue cap");
        assert_eq!(batch.dropped, MAX_MESSAGES_PER_PACKET as u64 - 10);
        assert!(hub.drain().is_none());
    }

    #[test]
    fn gate_and_listen_filter() {
        let hub = InputHub::new(10);
        hub.set_listen("d", vec!["in".into()]);
        assert!(!hub.accepts("d", "in"), "gate starts closed");
        hub.set_enabled(true);
        assert!(hub.accepts("d", "in"));
        assert!(!hub.accepts("d", "other"));
        assert!(!hub.accepts("other-desk", "in"));
        hub.forget_desk("d");
        assert!(!hub.accepts("d", "in"));
    }

    #[test]
    fn recognises_own_sockets_until_their_guard_drops() {
        let hub = Arc::new(InputHub::new(10));
        let exact = hub.register_own(addr("127.0.0.1:5000"));
        let any = hub.register_own(addr("0.0.0.0:6000"));
        assert_eq!(hub.origin(addr("127.0.0.1:5000")), Some(Origin::App));
        assert_eq!(
            hub.origin(addr("127.0.0.1:6000")),
            Some(Origin::App),
            "0.0.0.0 bind"
        );
        assert_eq!(
            hub.origin(addr("[::ffff:127.0.0.1]:6000")),
            Some(Origin::App),
            "IPv4-mapped"
        );
        assert_eq!(hub.origin(addr("127.0.0.1:5001")), None);
        assert_eq!(
            hub.origin(addr("203.0.113.7:6000")),
            None,
            "another machine on the same port is not us"
        );
        drop(exact);
        drop(any);
        assert_eq!(hub.origin(addr("127.0.0.1:5000")), None);
        assert_eq!(hub.origin(addr("127.0.0.1:6000")), None);
    }

    #[test]
    fn two_sockets_on_one_address_are_counted() {
        let hub = Arc::new(InputHub::new(10));
        let a = hub.register_own(addr("0.0.0.0:7000"));
        let b = hub.register_own(addr("0.0.0.0:7000"));
        drop(a);
        assert_eq!(hub.origin(addr("127.0.0.1:7000")), Some(Origin::App));
        drop(b);
        assert_eq!(hub.origin(addr("127.0.0.1:7000")), None);
    }

    #[test]
    fn peer_outputs_are_tagged() {
        let hub = InputHub::new(10);
        hub.set_peer_outputs([addr("192.0.2.5:9000")]);
        assert_eq!(hub.origin(addr("192.0.2.5:9000")), Some(Origin::Peer));
        assert_eq!(hub.origin(addr("192.0.2.5:9001")), None);
        // A peer app on this machine: its port, from any local IP.
        hub.set_peer_outputs([addr("127.0.0.1:9100")]);
        assert_eq!(hub.origin(addr("127.0.0.1:9100")), Some(Origin::Peer));
        assert_eq!(hub.origin(addr("192.0.2.5:9000")), None, "replaced");
    }

    #[test]
    fn own_ports_lists_every_output_socket() {
        let hub = Arc::new(InputHub::new(10));
        let _a = hub.register_own(addr("127.0.0.1:5000"));
        let _b = hub.register_own(addr("0.0.0.0:6000"));
        let _c = hub.register_own(addr("0.0.0.0:6000"));
        assert_eq!(hub.own_ports(), [5000, 6000]);
    }

    #[test]
    fn never_back_to_the_sender() {
        let hub = InputHub::new(10);
        // Another machine: any port on its IP.
        assert!(hub.is_origin(addr("192.0.2.5:9000"), addr("192.0.2.5:8000")));
        assert!(!hub.is_origin(addr("192.0.2.6:9000"), addr("192.0.2.5:8000")));
        // This machine: only the exact port, so two local apps can still bridge.
        assert!(hub.is_origin(addr("127.0.0.1:8000"), addr("127.0.0.1:8000")));
        assert!(!hub.is_origin(addr("127.0.0.1:9000"), addr("127.0.0.1:8000")));
    }
}
