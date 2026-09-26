//! Sessions, connections and peers.
//!
//! - Joining a session starts a listener, LAN discovery (optional) and a dialer per known
//!   address (manual peers, discovered apps). Both sides of a pair may dial. When two
//!   connections to the same peer exist, both sides keep the one dialled by the lower peer id.
//! - Every connection is authenticated first (noise.rs). Then both sides send a Hello, and
//!   either may turn the other down with a Bye: itself, blocked, incompatible, or full.
//! - Limits on inbound connections:
//!   - at most MAX_HANDSHAKES handshakes at once, MAX_HANDSHAKES_PER_IP from one IP;
//!   - an IP that fails BAN_FAILURES times within BAN_WINDOW is ignored for BAN_TIME.
//! - Once connected: a heartbeat, a per-peer rate limit, and bounded send queues (peer.rs).
//!   A peer that misbehaves is disconnected.

use std::collections::{HashMap, HashSet, VecDeque};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::value::RawValue;
use tokio::io::AsyncWriteExt;
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{oneshot, Notify, Semaphore};
use tokio::task::JoinHandle;

use super::discovery::{Discovery, Found};
use super::identity::{fingerprint_of, peer_id_of, random_bytes, session_hash, to_hex, Identity};
use super::noise::{
    check_preamble, handshake, preamble, write_frame, FrameReader, Opener, Sealer, PREAMBLE_LEN,
};
use super::peer::{write_loop, LinkStats, Outbox};
use super::ratelimit::{Limiter, Verdict};
use super::wire::{
    self, AppKind, Bye, ByeReason, Hello, Message, Ping, Pong, MAX_NAME_CHARS, MAX_PORTS, PROTOCOL,
};
use super::{
    LocalStatus, PeerInfo, PeerSource, PeerState, PeerStats, PeerStatus, Profile, SyncBatch,
    SyncConfig, SyncEvent, SyncInbox, SyncStatus, INBOX_CAP,
};
use crate::debug::{DebugEvent, DebugHub, DebugKind};
use crate::error::{AppError, AppResult};
use crate::input::InputHub;
use crate::net::resolve;

/// Most apps connected at once.
pub const MAX_PEERS: usize = 16;
const MAX_HANDSHAKES: usize = 8;
const MAX_HANDSHAKES_PER_IP: usize = 2;
const BAN_FAILURES: usize = 5;
const BAN_WINDOW: Duration = Duration::from_secs(60);
const BAN_TIME: Duration = Duration::from_secs(60);
/// After a Bye, how long the other side gets to finish sending before the link is dropped.
const CLOSE_GRACE: Duration = Duration::from_secs(2);
/// Floor between dial attempts, even when no backoff applies.
const MIN_REDIAL: Duration = Duration::from_millis(250);
/// Malformed messages tolerated from a peer before it is disconnected.
const MAX_MALFORMED: u32 = 20;
/// Sent in the clear by a responder whose last handshake message failed: the initiator can't
/// tell otherwise. Shorter than any encrypted frame (16-byte tag), so never mistaken for one.
const WRONG_KEY: &[u8] = b"\0wrong-key";

/// Timeouts and addresses; tests shorten them and stay on 127.0.0.1.
#[derive(Clone)]
pub struct SyncOptions {
    /// Where the device identity and the remembered session live.
    pub data_dir: PathBuf,
    pub app_version: String,
    pub bind_ip: IpAddr,
    /// When false, LAN discovery never starts, whatever the config says.
    pub allow_discovery: bool,
    pub handshake_timeout: Duration,
    pub heartbeat: Duration,
    pub peer_timeout: Duration,
    pub write_timeout: Duration,
    /// Delay before redialling after a failure: doubles from `min_backoff` to `max_backoff`.
    pub min_backoff: Duration,
    pub max_backoff: Duration,
}

impl SyncOptions {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            data_dir,
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            bind_ip: IpAddr::V4(Ipv4Addr::UNSPECIFIED),
            allow_discovery: true,
            handshake_timeout: Duration::from_secs(3),
            heartbeat: Duration::from_secs(2),
            peer_timeout: Duration::from_secs(6),
            write_timeout: Duration::from_secs(2),
            min_backoff: Duration::from_secs(1),
            max_backoff: Duration::from_secs(30),
        }
    }
}

pub type SyncStatusListener = Arc<dyn Fn(SyncStatus) + Send + Sync>;

struct Session {
    name: String,
    psk: [u8; 32],
    hash: [u8; 8],
    preamble: [u8; PREAMBLE_LEN],
    schema_version: u32,
}

/// A task that is aborted when its owner drops it.
struct Owned(JoinHandle<()>);

impl Drop for Owned {
    fn drop(&mut self) {
        self.0.abort();
    }
}

struct Link {
    conn: u64,
    /// Peer id of the side that dialled (decides which of two duplicate connections stays).
    initiator: String,
    instance_id: String,
    remote: SocketAddr,
    source: PeerSource,
    name: String,
    color: u8,
    app_version: String,
    osc_ports: Vec<u16>,
    outbox: Arc<Outbox>,
    stats: Arc<LinkStats>,
    since_ms: f64,
}

impl Link {
    fn stats(&self) -> PeerStats {
        let s = &self.stats;
        PeerStats {
            rx_msgs: s.rx_msgs.load(Ordering::Relaxed),
            tx_msgs: s.tx_msgs.load(Ordering::Relaxed),
            rx_bytes: s.rx_bytes.load(Ordering::Relaxed),
            tx_bytes: s.tx_bytes.load(Ordering::Relaxed),
            rejected: s.rejected.load(Ordering::Relaxed),
            dropped_values: self.outbox.dropped_values.load(Ordering::Relaxed),
        }
    }
}

#[derive(Clone)]
enum Dest {
    Host(String, u16),
    Addrs(Vec<SocketAddr>),
}

/// An address this app dials (a manual peer or a discovered app), with its dialer task.
struct Target {
    source: PeerSource,
    label: String,
    peer_id: Option<String>,
    state: PeerState,
    last_error: Option<String>,
    _task: Owned,
}

/// Everything that exists only while a session is joined; dropping it stops the listener,
/// discovery and dialers.
struct Run {
    session: Arc<Session>,
    listener: Option<Owned>,
    listening: Option<u16>,
    listen_error: Option<String>,
    discovery: Option<Discovery>,
    discovery_error: Option<String>,
    targets: HashMap<String, Target>,
    _ticker: Owned,
}

struct State {
    profile: Profile,
    config: SyncConfig,
    blocked: HashSet<String>,
    run: Option<Run>,
    links: HashMap<String, Link>,
    handshaking: HashMap<IpAddr, usize>,
    failures: HashMap<IpAddr, VecDeque<Instant>>,
    bans: HashMap<IpAddr, Instant>,
    next_conn: u64,
}

struct Inner {
    opts: SyncOptions,
    debug: Arc<DebugHub>,
    input: Arc<InputHub>,
    identity: Identity,
    identity_error: Option<String>,
    instance_id: String,
    inbox: SyncInbox,
    /// Desks shared (or being joined) here: messages about any other desk are dropped.
    desks: RwLock<HashSet<String>>,
    state: Mutex<State>,
    links_changed: Notify,
    on_status: SyncStatusListener,
}

/// An authenticated connection whose Hello arrived, not yet admitted.
struct Established {
    reader: FrameReader<OwnedReadHalf>,
    writer: OwnedWriteHalf,
    sealer: Sealer,
    opener: Opener,
    peer_id: String,
    hello: Hello,
}

enum SetupError {
    /// Couldn't connect, or the connection broke or stalled.
    Failed(String),
    /// Turned down: not OscOctopus, another session or version, or the wrong key.
    Refused(String),
}

enum DialError {
    Failed(String),
    Refused(String),
    /// Already connected to this peer through another connection.
    Duplicate(String),
    SelfConnection,
    /// The session changed meanwhile.
    Stale,
}

impl From<SetupError> for DialError {
    fn from(e: SetupError) -> Self {
        match e {
            SetupError::Failed(r) => DialError::Failed(r),
            SetupError::Refused(r) => DialError::Refused(r),
        }
    }
}

struct LinkEnd {
    reason: String,
    /// The peer said goodbye with a refusal (blocked, incompatible, full).
    refused: bool,
}

fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

/// Trims a device name, drops control characters and cuts it to MAX_NAME_CHARS.
fn clean_name(name: &str) -> String {
    let name: String = name
        .chars()
        .filter(|c| !c.is_control())
        .take(MAX_NAME_CHARS)
        .collect();
    let name = name.trim();
    if name.is_empty() {
        "OscOctopus".into()
    } else {
        name.into()
    }
}

fn clean_ports(mut ports: Vec<u16>) -> Vec<u16> {
    ports.truncate(MAX_PORTS);
    ports.sort_unstable();
    ports.dedup();
    ports
}

/// `host:port`, `[v6]:port`.
fn parse_host_port(spec: &str) -> Result<(String, u16), String> {
    let spec = spec.trim();
    let bad = || format!("'{spec}' is not host:port");
    let (host, port) = spec.rsplit_once(':').ok_or_else(bad)?;
    let host = host.trim_start_matches('[').trim_end_matches(']');
    let port: u16 = port.parse().map_err(|_| bad())?;
    if host.is_empty() || port == 0 {
        return Err(bad());
    }
    Ok((host.to_string(), port))
}

fn bye_text(bye: &Bye) -> String {
    let what = match bye.reason {
        ByeReason::Leaving => "left the session",
        ByeReason::Duplicate => "replaced by another connection",
        ByeReason::Blocked => "the other device blocked this one",
        ByeReason::Incompatible => "incompatible",
        ByeReason::Overload => "the other device is overloaded",
        ByeReason::SelfConnection => "this is this app's own address",
    };
    match &bye.detail {
        Some(detail) => format!("{what}: {detail}"),
        None => what.to_string(),
    }
}

pub struct SyncManager {
    inner: Arc<Inner>,
}

impl SyncManager {
    /// Loads (or creates) the device identity in `opts.data_dir`. A damaged identity file is
    /// reported in the status and replaced by a temporary identity for this launch.
    pub fn new(
        opts: SyncOptions,
        debug: Arc<DebugHub>,
        input: Arc<InputHub>,
        on_status: SyncStatusListener,
    ) -> Self {
        let (identity, identity_error) =
            match Identity::load_or_create(&opts.data_dir.join("identity.key")) {
                Ok(identity) => (identity, None),
                Err(e) => {
                    log::error!("sync identity: {e}");
                    (Identity::generate(), Some(e.to_string()))
                }
            };
        let profile = Profile {
            name: "OscOctopus".into(),
            color: 0,
        };
        Self {
            inner: Arc::new(Inner {
                opts,
                debug,
                input,
                identity,
                identity_error,
                instance_id: to_hex(&random_bytes::<8>()),
                inbox: SyncInbox::new(INBOX_CAP),
                desks: RwLock::default(),
                state: Mutex::new(State {
                    profile,
                    config: SyncConfig::default(),
                    blocked: HashSet::new(),
                    run: None,
                    links: HashMap::new(),
                    handshaking: HashMap::new(),
                    failures: HashMap::new(),
                    bans: HashMap::new(),
                    next_conn: 1,
                }),
                links_changed: Notify::new(),
                on_status,
            }),
        }
    }

    pub fn peer_id(&self) -> &str {
        self.inner.identity.peer_id()
    }

    pub fn session_file(&self) -> PathBuf {
        self.inner.opts.data_dir.join("session.json")
    }

    /// Where shared desks' sync records live (see docs.rs).
    pub fn docs_dir(&self) -> PathBuf {
        self.inner.opts.data_dir.join("docs")
    }

    pub fn status(&self) -> SyncStatus {
        self.inner.status()
    }

    /// Inbound events since the last call, for the UI flush loop.
    pub fn drain(&self) -> Option<SyncBatch> {
        self.inner.inbox.drain()
    }

    /// Joins `session` (leaving any other). `schema_version` is this app's preset schema:
    /// only peers with the same one are admitted.
    pub async fn join(&self, session: &str, psk: [u8; 32], schema_version: u32) -> SyncStatus {
        self.leave();
        let hash = session_hash(session);
        let session = Arc::new(Session {
            name: session.trim().to_string(),
            psk,
            hash,
            preamble: preamble(&hash),
            schema_version,
        });
        let ticker = self.inner.clone().spawn_ticker();
        self.inner.state.lock().unwrap().run = Some(Run {
            session: session.clone(),
            listener: None,
            listening: None,
            listen_error: None,
            discovery: None,
            discovery_error: None,
            targets: HashMap::new(),
            _ticker: ticker,
        });
        self.inner.log(
            DebugKind::Info,
            "sync",
            None,
            format!("joined session '{}'", session.name),
        );
        self.inner.reconcile(true).await;
        self.inner.emit();
        self.status()
    }

    /// Says goodbye to every peer and stops listening, discovery and dialling.
    pub fn leave(&self) {
        let inner = &self.inner;
        let (run, links) = {
            let mut st = inner.state.lock().unwrap();
            (st.run.take(), std::mem::take(&mut st.links))
        };
        let Some(run) = run else { return };
        let name = run.session.name.clone();
        drop(run);
        for (peer, link) in links {
            inner.bye(&link.outbox, ByeReason::Leaving, None);
            inner.inbox.push(SyncEvent::Down {
                peer,
                reason: "left the session".into(),
            });
        }
        inner.input.set_peer_outputs([]);
        inner.links_changed.notify_waiters();
        inner.log(
            DebugKind::Info,
            "sync",
            None,
            format!("left session '{name}'"),
        );
        inner.emit();
    }

    pub fn set_profile(&self, name: &str, color: u8) -> SyncStatus {
        self.inner.state.lock().unwrap().profile = Profile {
            name: clean_name(name),
            color,
        };
        self.inner.emit();
        self.status()
    }

    pub async fn set_config(&self, mut config: SyncConfig) -> AppResult<SyncStatus> {
        let mut seen = HashSet::new();
        config.manual_peers.retain(|p| !p.trim().is_empty());
        for spec in &mut config.manual_peers {
            *spec = spec.trim().to_string();
            parse_host_port(spec).map_err(AppError::Config)?;
        }
        config.manual_peers.retain(|p| seen.insert(p.clone()));
        let rebind = {
            let mut st = self.inner.state.lock().unwrap();
            let rebind = st.config.port != config.port;
            st.config = config;
            rebind
        };
        self.inner.reconcile(rebind).await;
        self.inner.emit();
        Ok(self.status())
    }

    /// The desks this app shares (or is joining): messages about other desks are dropped.
    pub fn set_desks(&self, desks: Vec<String>) {
        *self.inner.desks.write().unwrap() = desks.into_iter().collect();
    }

    /// Devices (by peer id) refused from now on; connected ones are disconnected.
    pub fn set_blocked(&self, peer_ids: Vec<String>) -> SyncStatus {
        let blocked: HashSet<String> = peer_ids.into_iter().collect();
        let to_close: Vec<Arc<Outbox>> = {
            let mut st = self.inner.state.lock().unwrap();
            st.blocked = blocked;
            st.links
                .iter()
                .filter(|(id, _)| st.blocked.contains(*id))
                .map(|(_, l)| l.outbox.clone())
                .collect()
        };
        for outbox in to_close {
            self.inner.bye(&outbox, ByeReason::Blocked, None);
        }
        self.inner.emit();
        self.status()
    }

    /// Queues an app message for one peer, or every connected peer. Never waits: returns the
    /// number of peers it was queued for. A peer whose reliable queue is full is disconnected.
    pub fn send(
        &self,
        peer: Option<&str>,
        kind: AppKind,
        desk: Option<&str>,
        body: &str,
    ) -> Result<usize, String> {
        let bytes = wire::encode_app(kind, desk, body)?;
        let outboxes: Vec<(String, Arc<Outbox>)> = {
            let st = self.inner.state.lock().unwrap();
            st.links
                .iter()
                .filter(|(id, _)| peer.is_none_or(|p| p == id.as_str()))
                .map(|(id, l)| (id.clone(), l.outbox.clone()))
                .collect()
        };
        let mut queued = 0;
        for (id, outbox) in outboxes {
            if kind.droppable() {
                outbox.push_value(bytes.clone());
                queued += 1;
            } else if outbox.push_reliable(bytes.clone()) {
                queued += 1;
            } else {
                outbox.abort("its send queue overflowed (not keeping up)");
                self.inner.log(
                    DebugKind::Error,
                    &id,
                    None,
                    "disconnecting: the peer is not keeping up (send queue full)".into(),
                );
            }
        }
        Ok(queued)
    }
}

impl Inner {
    fn log(&self, kind: DebugKind, endpoint: &str, remote: Option<SocketAddr>, message: String) {
        self.debug.push(DebugEvent {
            kind,
            endpoint_id: endpoint.to_string(),
            endpoint_name: "sync".into(),
            remote: remote.map(|r| r.to_string()),
            message: Some(message),
            ..Default::default()
        });
    }

    fn emit(&self) {
        (self.on_status)(self.status());
    }

    fn status(&self) -> SyncStatus {
        let st = self.state.lock().unwrap();
        let mut peers: Vec<PeerStatus> = st
            .links
            .iter()
            .map(|(id, l)| PeerStatus {
                peer_id: Some(id.clone()),
                fingerprint: Some(fingerprint_of(id)),
                address: l.remote.to_string(),
                source: l.source,
                state: PeerState::Connected,
                name: Some(l.name.clone()),
                color: Some(l.color),
                app_version: Some(l.app_version.clone()),
                rtt_ms: *l.stats.rtt_ms.lock().unwrap(),
                clock_offset_ms: *l.stats.clock_offset_ms.lock().unwrap(),
                connected_since_ms: Some(l.since_ms),
                stats: l.stats(),
                last_error: None,
            })
            .collect();
        let run = st.run.as_ref();
        for t in run.iter().flat_map(|r| r.targets.values()) {
            if t.peer_id.as_ref().is_some_and(|p| st.links.contains_key(p)) {
                continue; // listed as its connection
            }
            peers.push(PeerStatus {
                peer_id: t.peer_id.clone(),
                fingerprint: t.peer_id.as_deref().map(fingerprint_of),
                address: t.label.clone(),
                source: t.source,
                // Its connection just ended and the dialer hasn't caught up yet.
                state: match t.state {
                    PeerState::Connected => PeerState::Retrying,
                    state => state,
                },
                name: None,
                color: None,
                app_version: None,
                rtt_ms: None,
                clock_offset_ms: None,
                connected_since_ms: None,
                stats: PeerStats::default(),
                last_error: t.last_error.clone(),
            });
        }
        peers.sort_by(|a, b| {
            (a.state != PeerState::Connected, &a.name, &a.address).cmp(&(
                b.state != PeerState::Connected,
                &b.name,
                &b.address,
            ))
        });
        let mut blocked: Vec<String> = st.blocked.iter().cloned().collect();
        blocked.sort();
        SyncStatus {
            local: LocalStatus {
                peer_id: self.identity.peer_id().to_string(),
                fingerprint: self.identity.fingerprint(),
                instance_id: self.instance_id.clone(),
                profile: st.profile.clone(),
                identity_error: self.identity_error.clone(),
            },
            config: st.config.clone(),
            session: run.map(|r| r.session.name.clone()),
            listening: run.and_then(|r| r.listening),
            listen_error: run.and_then(|r| r.listen_error.clone()),
            discovery_active: run.is_some_and(|r| r.discovery.is_some()),
            discovery_error: run.and_then(|r| r.discovery_error.clone()),
            peers,
            blocked,
        }
    }

    fn hello(&self, session: &Session) -> Hello {
        let profile = self.state.lock().unwrap().profile.clone();
        Hello {
            proto: PROTOCOL,
            app_version: self.opts.app_version.clone(),
            schema_version: session.schema_version,
            instance_id: self.instance_id.clone(),
            name: profile.name,
            color: profile.color,
            osc_ports: self.input.own_ports(),
        }
    }

    fn ping(&self, seq: u64) -> Ping {
        let profile = self.state.lock().unwrap().profile.clone();
        Ping {
            seq,
            wall_ms: now_ms(),
            osc_ports: self.input.own_ports(),
            name: profile.name,
            color: profile.color,
        }
    }

    /// Queues a goodbye and closes the link once it is sent.
    fn bye(&self, outbox: &Outbox, reason: ByeReason, detail: Option<String>) {
        let bye = Bye { reason, detail };
        let text = bye_text(&bye);
        outbox.push_reliable(wire::encode_control(&Message::Bye(bye)));
        outbox.close(text);
    }

    /// Tells the input hub which OSC packets come from peer apps (never applied to widgets).
    fn refresh_peer_outputs(&self) {
        let addrs: Vec<SocketAddr> = {
            let st = self.state.lock().unwrap();
            st.links
                .values()
                .flat_map(|l| {
                    let ip = l.remote.ip();
                    l.osc_ports.iter().map(move |p| SocketAddr::new(ip, *p))
                })
                .collect()
        };
        self.input.set_peer_outputs(addrs);
    }

    fn is_connected(&self, peer_id: &str) -> bool {
        self.state.lock().unwrap().links.contains_key(peer_id)
    }

    async fn wait_disconnected(&self, peer_id: &str) {
        loop {
            let changed = self.links_changed.notified();
            if !self.is_connected(peer_id) {
                return;
            }
            changed.await;
        }
    }

    fn same_session(st: &State, session: &Arc<Session>) -> bool {
        st.run
            .as_ref()
            .is_some_and(|r| Arc::ptr_eq(&r.session, session))
    }

    /// Re-emits the status every heartbeat while joined (RTT and counters move).
    fn spawn_ticker(self: Arc<Self>) -> Owned {
        let period = self.opts.heartbeat;
        let weak = Arc::downgrade(&self);
        drop(self);
        Owned(tokio::spawn(async move {
            let mut tick = tokio::time::interval(period);
            tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                tick.tick().await;
                let Some(inner) = weak.upgrade() else { return };
                inner.emit();
            }
        }))
    }

    /// Brings the listener, discovery and manual dialers in line with the config.
    async fn reconcile(self: &Arc<Self>, rebind: bool) {
        let (session, port, needs_bind) = {
            let st = self.state.lock().unwrap();
            let Some(run) = &st.run else { return };
            (
                run.session.clone(),
                st.config.port,
                rebind || run.listener.is_none(),
            )
        };
        if needs_bind {
            let (listener, error) = bind(self.opts.bind_ip, port).await;
            let mut st = self.state.lock().unwrap();
            if !Self::same_session(&st, &session) {
                return;
            }
            let run = st.run.as_mut().unwrap();
            run.discovery = None; // re-advertised with the new port below
            run.listen_error = error;
            run.listening = listener
                .as_ref()
                .and_then(|l| l.local_addr().ok())
                .map(|a| a.port());
            run.listener =
                listener.map(|l| Owned(tokio::spawn(self.clone().accept_loop(l, session.clone()))));
            if let Some(port) = run.listening {
                drop(st);
                self.log(
                    DebugKind::Info,
                    "sync",
                    None,
                    format!("listening for sync on port {port}"),
                );
            }
        }

        // Discovery: started outside the lock (it spawns a thread and opens sockets).
        let start_discovery = {
            let mut st = self.state.lock().unwrap();
            let want = st.config.discovery && self.opts.allow_discovery;
            let Some(run) = st.run.as_mut() else { return };
            if !want {
                run.discovery = None;
                run.discovery_error = None;
                run.targets.retain(|k, _| !k.starts_with("mdns/"));
                None
            } else if run.discovery.is_none() {
                run.listening
            } else {
                None
            }
        };
        if let Some(port) = start_discovery {
            let weak = Arc::downgrade(self);
            let started = Discovery::start(port, &self.instance_id, &session.hash, move |found| {
                let Some(inner) = weak.upgrade() else { return };
                match found {
                    Found::Up { key, addrs } => {
                        let label = addrs
                            .iter()
                            .map(ToString::to_string)
                            .collect::<Vec<_>>()
                            .join(", ");
                        inner.add_target(
                            format!("mdns/{key}"),
                            PeerSource::Discovered,
                            label,
                            Dest::Addrs(addrs),
                        );
                    }
                    Found::Down { key } => inner.remove_target(&format!("mdns/{key}")),
                }
            });
            let mut st = self.state.lock().unwrap();
            if Self::same_session(&st, &session) {
                let run = st.run.as_mut().unwrap();
                match started {
                    Ok(discovery) => {
                        run.discovery = Some(discovery);
                        run.discovery_error = None;
                    }
                    Err(e) => run.discovery_error = Some(e),
                }
            }
        }

        // Manual peers.
        let missing: Vec<String> = {
            let mut st = self.state.lock().unwrap();
            let wanted: HashSet<String> = st.config.manual_peers.iter().cloned().collect();
            let Some(run) = st.run.as_mut() else { return };
            run.targets.retain(|k, _| {
                k.strip_prefix("manual/")
                    .is_none_or(|spec| wanted.contains(spec))
            });
            wanted
                .into_iter()
                .filter(|spec| !run.targets.contains_key(&format!("manual/{spec}")))
                .collect()
        };
        for spec in missing {
            if let Ok((host, port)) = parse_host_port(&spec) {
                self.add_target(
                    format!("manual/{spec}"),
                    PeerSource::Manual,
                    spec,
                    Dest::Host(host, port),
                );
            }
        }
    }

    fn add_target(self: &Arc<Self>, key: String, source: PeerSource, label: String, dest: Dest) {
        {
            let mut st = self.state.lock().unwrap();
            let Some(run) = st.run.as_mut() else { return };
            if run.targets.get(&key).is_some_and(|t| t.label == label) {
                return;
            }
            let task = tokio::spawn(self.clone().dial_loop(
                key.clone(),
                source,
                dest,
                run.session.clone(),
            ));
            run.targets.insert(
                key,
                Target {
                    source,
                    label,
                    peer_id: None,
                    state: PeerState::Connecting,
                    last_error: None,
                    _task: Owned(task),
                },
            );
        }
        self.emit();
    }

    /// Stops dialling an address. A connection already made through it stays up.
    fn remove_target(&self, key: &str) {
        let removed = {
            let mut st = self.state.lock().unwrap();
            st.run
                .as_mut()
                .and_then(|r| r.targets.remove(key))
                .is_some()
        };
        if removed {
            self.emit();
        }
    }

    fn set_target(
        &self,
        key: &str,
        state: PeerState,
        error: Option<String>,
        peer_id: Option<String>,
    ) {
        {
            let mut st = self.state.lock().unwrap();
            let Some(t) = st.run.as_mut().and_then(|r| r.targets.get_mut(key)) else {
                return;
            };
            t.state = state;
            if error.is_some() || state == PeerState::Connected {
                t.last_error = error;
            }
            if peer_id.is_some() {
                t.peer_id = peer_id;
            }
        }
        self.emit();
    }

    /// Dials one address until the session ends or the target is removed, backing off after
    /// failures and waiting while the peer is connected by any connection.
    async fn dial_loop(
        self: Arc<Self>,
        key: String,
        source: PeerSource,
        dest: Dest,
        session: Arc<Session>,
    ) {
        let mut backoff = self.opts.min_backoff;
        let mut peer_id: Option<String> = None;
        let mut next_attempt = tokio::time::Instant::now();
        loop {
            if let Some(pid) = peer_id.clone() {
                if self.is_connected(&pid) {
                    self.set_target(&key, PeerState::Connected, None, Some(pid.clone()));
                    self.wait_disconnected(&pid).await;
                }
            }
            tokio::time::sleep_until(next_attempt).await;
            next_attempt = tokio::time::Instant::now() + MIN_REDIAL;
            self.set_target(&key, PeerState::Connecting, None, None);
            let (state, error) = match self.dial_once(&dest, source, &session).await {
                Ok((pid, done)) => {
                    peer_id = Some(pid.clone());
                    self.set_target(&key, PeerState::Connected, None, Some(pid));
                    backoff = self.opts.min_backoff;
                    let end = done.await.unwrap_or(LinkEnd {
                        reason: "stopped".into(),
                        refused: false,
                    });
                    if peer_id.as_deref().is_some_and(|p| self.is_connected(p)) {
                        continue; // replaced by the other side's connection
                    }
                    let state = if end.refused {
                        PeerState::Refused
                    } else {
                        PeerState::Retrying
                    };
                    (state, end.reason)
                }
                Err(DialError::Duplicate(pid)) => {
                    peer_id = Some(pid);
                    continue;
                }
                Err(DialError::SelfConnection) => {
                    self.set_target(
                        &key,
                        PeerState::Refused,
                        Some("this is this app's own address".into()),
                        None,
                    );
                    return;
                }
                Err(DialError::Stale) => return,
                Err(DialError::Refused(r)) => (PeerState::Refused, r),
                Err(DialError::Failed(r)) => (PeerState::Retrying, r),
            };
            self.set_target(&key, state, Some(error), peer_id.clone());
            next_attempt = tokio::time::Instant::now() + backoff;
            backoff = (backoff * 2).min(self.opts.max_backoff);
        }
    }

    async fn dial_once(
        self: &Arc<Self>,
        dest: &Dest,
        source: PeerSource,
        session: &Arc<Session>,
    ) -> Result<(String, oneshot::Receiver<LinkEnd>), DialError> {
        let addrs = match dest {
            Dest::Host(host, port) => {
                vec![resolve(host, *port).await.map_err(DialError::Failed)?]
            }
            Dest::Addrs(addrs) => addrs.clone(),
        };
        let mut last_error = "no address to dial".to_string();
        for addr in addrs {
            match tokio::time::timeout(self.opts.handshake_timeout, TcpStream::connect(addr)).await
            {
                Ok(Ok(stream)) => {
                    let est = self.establish(stream, true, session).await?;
                    return self.admit(est, true, addr, source, session).await;
                }
                Ok(Err(e)) => last_error = format!("could not connect to {addr}: {e}"),
                Err(_) => last_error = format!("could not connect to {addr}: timed out"),
            }
        }
        Err(DialError::Failed(last_error))
    }

    async fn accept_loop(self: Arc<Self>, listener: TcpListener, session: Arc<Session>) {
        let permits = Arc::new(Semaphore::new(MAX_HANDSHAKES));
        loop {
            let (stream, remote) = match listener.accept().await {
                Ok(accepted) => accepted,
                Err(_) => {
                    // E.g. out of file descriptors: back off instead of spinning.
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    continue;
                }
            };
            let ip = remote.ip().to_canonical();
            let Ok(permit) = permits.clone().try_acquire_owned() else {
                continue; // too many handshakes at once: dropped
            };
            if !self.begin_handshake(ip) {
                continue; // banned, or too many from this IP
            }
            let inner = self.clone();
            let session = session.clone();
            tokio::spawn(async move {
                let _permit = permit;
                let result = inner.establish(stream, false, &session).await;
                inner.end_handshake(ip);
                match result {
                    Ok(est) => {
                        // Refusals are answered and logged in `admit`.
                        let _ = inner
                            .admit(est, false, remote, PeerSource::Incoming, &session)
                            .await;
                    }
                    Err(SetupError::Refused(r) | SetupError::Failed(r)) => {
                        if !r.starts_with("different session") {
                            inner.note_failure(ip);
                        }
                        inner.log(
                            DebugKind::Error,
                            "sync",
                            Some(remote),
                            format!("refused a connection from {ip}: {r}"),
                        );
                    }
                }
            });
        }
    }

    fn begin_handshake(&self, ip: IpAddr) -> bool {
        let mut st = self.state.lock().unwrap();
        let now = Instant::now();
        st.bans.retain(|_, until| *until > now);
        if st.bans.contains_key(&ip) {
            return false;
        }
        let n = st.handshaking.entry(ip).or_default();
        if *n >= MAX_HANDSHAKES_PER_IP {
            return false;
        }
        *n += 1;
        true
    }

    fn end_handshake(&self, ip: IpAddr) {
        let mut st = self.state.lock().unwrap();
        if let Some(n) = st.handshaking.get_mut(&ip) {
            *n -= 1;
            if *n == 0 {
                st.handshaking.remove(&ip);
            }
        }
    }

    fn note_failure(&self, ip: IpAddr) {
        let banned = {
            let mut st = self.state.lock().unwrap();
            let now = Instant::now();
            let failures = st.failures.entry(ip).or_default();
            failures.push_back(now);
            while failures
                .front()
                .is_some_and(|t| now.duration_since(*t) > BAN_WINDOW)
            {
                failures.pop_front();
            }
            if failures.len() >= BAN_FAILURES {
                st.failures.remove(&ip);
                st.bans.insert(ip, now + BAN_TIME);
                true
            } else {
                false
            }
        };
        if banned {
            self.log(
                DebugKind::Error,
                "sync",
                None,
                format!(
                    "ignoring {ip} for {} s after {BAN_FAILURES} failed connection attempts",
                    BAN_TIME.as_secs()
                ),
            );
        }
    }

    /// Preamble, handshake and Hello exchange, all within the handshake timeout.
    async fn establish(
        &self,
        stream: TcpStream,
        initiator: bool,
        session: &Session,
    ) -> Result<Established, SetupError> {
        use SetupError::{Failed, Refused};
        let _ = stream.set_nodelay(true);
        let (read_half, mut writer) = stream.into_split();
        let mut reader = FrameReader::new(read_half);
        let setup = async {
            writer
                .write_all(&session.preamble)
                .await
                .map_err(|e| Failed(format!("connection closed during setup ({e})")))?;
            let theirs = reader.read_exact_raw(PREAMBLE_LEN).await.map_err(Failed)?;
            check_preamble(&session.preamble, &theirs).map_err(Refused)?;
            // Both preambles, the initiator's first, bind the handshake to what was agreed.
            let prologue: Vec<u8> = if initiator {
                [&session.preamble[..], &theirs].concat()
            } else {
                [&theirs[..], &session.preamble[..]].concat()
            };
            let channel = match handshake(
                &mut reader,
                &mut writer,
                initiator,
                &self.identity,
                &session.psk,
                &prologue,
            )
            .await
            {
                Ok(channel) => channel,
                Err(e) if e == "wrong session key" => {
                    // Tell the initiator, then let it read that before the socket closes.
                    let _ = write_frame(&mut writer, WRONG_KEY).await;
                    let _ = writer.shutdown().await;
                    let _ = tokio::time::timeout(Duration::from_millis(500), async {
                        while reader.next().await.is_ok() {}
                    })
                    .await;
                    return Err(Refused(e));
                }
                Err(e) => return Err(Failed(format!("handshake failed: {e}"))),
            };
            let mut sealer = Sealer::new(channel.transport.clone());
            let mut opener = Opener::new(channel.transport.clone());
            let hello = wire::encode_control(&Message::Hello(self.hello(session)));
            for frame in sealer.seal(&hello).map_err(Failed)? {
                write_frame(&mut writer, &frame)
                    .await
                    .map_err(|e| Failed(format!("connection closed during setup ({e})")))?;
            }
            let bytes = loop {
                let frame = reader.next().await.map_err(Failed)?;
                if frame == WRONG_KEY {
                    return Err(Refused(
                        "wrong session key (the other device refused it)".into(),
                    ));
                }
                match opener.open(&frame) {
                    Ok(Some(bytes)) => break bytes,
                    Ok(None) => continue,
                    Err(_) => return Err(Refused("wrong session key".into())),
                }
            };
            let Ok(Message::Hello(hello)) = wire::decode(&bytes) else {
                return Err(Failed("the other side did not say hello".into()));
            };
            Ok((sealer, opener, peer_id_of(&channel.remote_static), hello))
        };
        let (sealer, opener, peer_id, hello) =
            tokio::time::timeout(self.opts.handshake_timeout, setup)
                .await
                .map_err(|_| Failed("no answer during setup (timed out)".into()))??;
        Ok(Established {
            reader,
            writer,
            sealer,
            opener,
            peer_id,
            hello,
        })
    }

    /// Admits an established connection as the link to its peer, or turns it down.
    async fn admit(
        self: &Arc<Self>,
        mut est: Established,
        initiator: bool,
        remote: SocketAddr,
        source: PeerSource,
        session: &Arc<Session>,
    ) -> Result<(String, oneshot::Receiver<LinkEnd>), DialError> {
        let peer_id = est.peer_id.clone();
        let my_id = self.identity.peer_id().to_string();
        let hello = est.hello.clone();
        let name = clean_name(&hello.name);

        let refusal = if peer_id == my_id && hello.instance_id == self.instance_id {
            let why = "this is this app's own address";
            Some((
                ByeReason::SelfConnection,
                why.to_string(),
                DialError::SelfConnection,
            ))
        } else if peer_id == my_id {
            let why = "another app uses this device's identity (a copied identity.key?)";
            Some((
                ByeReason::Incompatible,
                why.to_string(),
                DialError::Refused(why.into()),
            ))
        } else if hello.proto.0 != PROTOCOL.0 || hello.schema_version != session.schema_version {
            let why = format!(
                "desk format v{} here, v{} on {name}: update OscOctopus on the older device",
                session.schema_version, hello.schema_version
            );
            Some((
                ByeReason::Incompatible,
                why.clone(),
                DialError::Refused(why),
            ))
        } else {
            None
        };
        if let Some((reason, why, error)) = refusal {
            // A self-connection is seen from both ends: say it once, from the dialling end.
            if initiator || !matches!(error, DialError::SelfConnection) {
                self.log(
                    DebugKind::Error,
                    "sync",
                    Some(remote),
                    format!("not connecting to {remote}: {why}"),
                );
            }
            self.refuse(&mut est, reason, Some(why)).await;
            return Err(error);
        }

        enum Decision {
            Refuse(ByeReason, String, DialError),
            Admit {
                conn: u64,
                outbox: Arc<Outbox>,
                stats: Arc<LinkStats>,
                /// The link this one replaces, and whether the peer restarted (so the UI
                /// hears it went down and came back).
                replaced: Option<(Link, bool)>,
            },
        }
        let initiator_id = if initiator { &my_id } else { &peer_id };
        let decision = {
            let mut st = self.state.lock().unwrap();
            if !Self::same_session(&st, session) {
                Decision::Refuse(ByeReason::Leaving, String::new(), DialError::Stale)
            } else if st.blocked.contains(&peer_id) {
                Decision::Refuse(
                    ByeReason::Blocked,
                    format!("{name} is blocked here"),
                    DialError::Refused("blocked on this device".into()),
                )
            } else {
                let existing = st.links.get(&peer_id);
                let restarted = existing.is_some_and(|l| l.instance_id != hello.instance_id);
                let keep_existing = existing.is_some_and(|l| {
                    // Same side dialled twice: keep the first. Otherwise both sides keep the
                    // one dialled by the lower peer id, so they agree without talking.
                    !restarted
                        && (l.initiator == *initiator_id
                            || l.initiator == *my_id.as_str().min(peer_id.as_str()))
                });
                if keep_existing {
                    Decision::Refuse(
                        ByeReason::Duplicate,
                        String::new(),
                        DialError::Duplicate(peer_id.clone()),
                    )
                } else if existing.is_none() && st.links.len() >= MAX_PEERS {
                    Decision::Refuse(
                        ByeReason::Overload,
                        format!("at most {MAX_PEERS} devices"),
                        DialError::Refused(format!("too many devices (at most {MAX_PEERS})")),
                    )
                } else {
                    let conn = st.next_conn;
                    st.next_conn += 1;
                    let outbox = Arc::new(Outbox::default());
                    let stats = Arc::new(LinkStats::default());
                    let replaced = st.links.insert(
                        peer_id.clone(),
                        Link {
                            conn,
                            initiator: initiator_id.clone(),
                            instance_id: hello.instance_id.chars().take(64).collect(),
                            remote,
                            source,
                            name: name.clone(),
                            color: hello.color,
                            app_version: hello.app_version.chars().take(32).collect(),
                            osc_ports: clean_ports(hello.osc_ports.clone()),
                            outbox: outbox.clone(),
                            stats: stats.clone(),
                            since_ms: now_ms(),
                        },
                    );
                    Decision::Admit {
                        conn,
                        outbox,
                        stats,
                        replaced: replaced.map(|l| (l, restarted)),
                    }
                }
            }
        };

        let (conn, outbox, stats, replaced) = match decision {
            Decision::Refuse(reason, detail, error) => {
                if matches!(error, DialError::Refused(_)) {
                    self.log(
                        DebugKind::Error,
                        &peer_id,
                        Some(remote),
                        format!("refused {name}: {detail}"),
                    );
                }
                if !matches!(error, DialError::Stale) {
                    let detail = (!detail.is_empty()).then_some(detail);
                    self.refuse(&mut est, reason, detail).await;
                }
                return Err(error);
            }
            Decision::Admit {
                conn,
                outbox,
                stats,
                replaced,
            } => (conn, outbox, stats, replaced),
        };

        let up = SyncEvent::Up {
            peer: PeerInfo {
                peer_id: peer_id.clone(),
                fingerprint: fingerprint_of(&peer_id),
                name: name.clone(),
                color: est.hello.color,
                app_version: est.hello.app_version.chars().take(32).collect(),
                address: remote.to_string(),
            },
        };
        match replaced {
            Some((old, true)) => {
                old.outbox.abort("the peer restarted");
                self.inbox.push(SyncEvent::Down {
                    peer: peer_id.clone(),
                    reason: "restarted".into(),
                });
                self.inbox.push(up);
            }
            Some((old, false)) => self.bye(&old.outbox, ByeReason::Duplicate, None),
            None => {
                self.inbox.push(up);
                self.log(
                    DebugKind::Info,
                    &peer_id,
                    Some(remote),
                    format!(
                        "connected to {name} ({}) at {remote}",
                        fingerprint_of(&peer_id)
                    ),
                );
            }
        }
        self.refresh_peer_outputs();
        self.links_changed.notify_waiters();
        self.emit();

        let (done_tx, done_rx) = oneshot::channel();
        tokio::spawn(
            self.clone()
                .run_link(est, conn, outbox, stats, name, done_tx),
        );
        Ok((peer_id, done_rx))
    }

    /// Sends a goodbye on a connection that was not admitted, then closes it.
    async fn refuse(&self, est: &mut Established, reason: ByeReason, detail: Option<String>) {
        let bye = wire::encode_control(&Message::Bye(Bye { reason, detail }));
        let (writer, sealer) = (&mut est.writer, &mut est.sealer);
        let _ = tokio::time::timeout(self.opts.write_timeout, async {
            for frame in sealer.seal(&bye).unwrap_or_default() {
                write_frame(writer, &frame).await?;
            }
            writer.shutdown().await
        })
        .await;
    }

    /// Serves one admitted link until it ends: reads, heartbeats and graceful closing. The
    /// writer runs as its own task (peer.rs).
    async fn run_link(
        self: Arc<Self>,
        est: Established,
        conn: u64,
        outbox: Arc<Outbox>,
        stats: Arc<LinkStats>,
        name: String,
        done: oneshot::Sender<LinkEnd>,
    ) {
        let Established {
            mut reader,
            writer,
            sealer,
            mut opener,
            peer_id,
            ..
        } = est;
        let mut writer_task = tokio::spawn(write_loop(
            writer,
            sealer,
            outbox.clone(),
            stats.clone(),
            self.opts.write_timeout,
        ));
        let mut limiter = Limiter::default();
        let mut tick = tokio::time::interval(self.opts.heartbeat);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut last_rx = Instant::now();
        let mut ping_seq = 0u64;
        let mut malformed = 0u32;
        let mut refused = false;
        // Set once closing started: until when the peer may still send, and why.
        let mut closing: Option<(tokio::time::Instant, String)> = None;

        let reason = loop {
            let deadline = closing.as_ref().map(|(d, _)| *d);
            tokio::select! {
                frame = reader.next() => {
                    let frame = match frame {
                        Ok(frame) => frame,
                        Err(e) => break closing.take().map_or(e, |(_, r)| r),
                    };
                    last_rx = Instant::now();
                    stats.rx_bytes.fetch_add(frame.len() as u64 + 4, Ordering::Relaxed);
                    let bytes = match opener.open(&frame) {
                        Ok(Some(bytes)) => bytes,
                        Ok(None) => continue,
                        Err(e) => break e,
                    };
                    match limiter.check(bytes.len(), Instant::now()) {
                        Verdict::Accept => {}
                        Verdict::Drop => {
                            stats.rejected.fetch_add(1, Ordering::Relaxed);
                            continue;
                        }
                        Verdict::Flooding => {
                            self.bye(&outbox, ByeReason::Overload, Some("too many messages".into()));
                            break "it sent too many messages (flooding)".into();
                        }
                    }
                    stats.rx_msgs.fetch_add(1, Ordering::Relaxed);
                    match wire::decode(&bytes) {
                        Ok(Message::App { kind, desk, body }) => {
                            self.deliver(&peer_id, kind, desk, body)
                        }
                        Ok(Message::Ping(ping)) => {
                            let pong = Pong {
                                seq: ping.seq,
                                wall_ms: ping.wall_ms,
                                peer_wall_ms: now_ms(),
                            };
                            outbox.push_reliable(wire::encode_control(&Message::Pong(pong)));
                            self.peer_update(&peer_id, conn, ping);
                        }
                        Ok(Message::Pong(pong)) => {
                            let rtt = (now_ms() - pong.wall_ms).max(0.0);
                            *stats.rtt_ms.lock().unwrap() = Some(rtt);
                            *stats.clock_offset_ms.lock().unwrap() =
                                Some(pong.peer_wall_ms - (pong.wall_ms + rtt / 2.0));
                        }
                        Ok(Message::Bye(bye)) => {
                            refused = matches!(
                                bye.reason,
                                ByeReason::Blocked | ByeReason::Incompatible | ByeReason::Overload
                            );
                            break bye_text(&bye);
                        }
                        other => {
                            let what = match other {
                                Err(e) => e,
                                _ => "a second hello".into(),
                            };
                            stats.rejected.fetch_add(1, Ordering::Relaxed);
                            malformed += 1;
                            if malformed == 1 {
                                self.log(
                                    DebugKind::Error,
                                    &peer_id,
                                    None,
                                    format!("malformed message from {name}: {what}"),
                                );
                            }
                            if malformed >= MAX_MALFORMED {
                                self.bye(&outbox, ByeReason::Incompatible, Some("malformed messages".into()));
                                break "it sent malformed messages".into();
                            }
                        }
                    }
                }
                _ = tick.tick(), if closing.is_none() => {
                    if last_rx.elapsed() > self.opts.peer_timeout {
                        break format!("no answer for {} s", self.opts.peer_timeout.as_secs());
                    }
                    ping_seq += 1;
                    let ping = wire::encode_control(&Message::Ping(self.ping(ping_seq)));
                    if !outbox.push_reliable(ping) {
                        outbox.abort("its send queue overflowed");
                        break "it is not keeping up (send queue full)".into();
                    }
                }
                reason = outbox.wait_closed(), if closing.is_none() => {
                    closing = Some((tokio::time::Instant::now() + CLOSE_GRACE, reason));
                }
                _ = async {
                    match deadline {
                        Some(d) => tokio::time::sleep_until(d).await,
                        None => std::future::pending().await,
                    }
                }, if deadline.is_some() => {
                    break closing.take().map(|(_, r)| r).unwrap_or_default();
                }
            }
        };

        // Let the writer finish what is queued (a Bye), within the write timeout.
        outbox.close(reason.clone());
        if tokio::time::timeout(self.opts.write_timeout, &mut writer_task)
            .await
            .is_err()
        {
            writer_task.abort();
        }
        self.unregister(&peer_id, conn, &name, &reason);
        let _ = done.send(LinkEnd { reason, refused });
    }

    fn deliver(&self, peer: &str, kind: AppKind, desk: Option<String>, body: Box<RawValue>) {
        if let Some(desk) = &desk {
            if !self.desks.read().unwrap().contains(desk) {
                return;
            }
        }
        self.inbox.push(SyncEvent::Message {
            peer: peer.to_string(),
            kind,
            desk,
            body,
        });
    }

    /// A ping carries the peer's current OSC ports, name and colour.
    fn peer_update(&self, peer_id: &str, conn: u64, ping: Ping) {
        let ports_changed = {
            let mut st = self.state.lock().unwrap();
            let Some(link) = st.links.get_mut(peer_id).filter(|l| l.conn == conn) else {
                return;
            };
            link.name = clean_name(&ping.name);
            link.color = ping.color;
            let ports = clean_ports(ping.osc_ports);
            let changed = link.osc_ports != ports;
            link.osc_ports = ports;
            changed
        };
        if ports_changed {
            self.refresh_peer_outputs();
        }
    }

    fn unregister(&self, peer_id: &str, conn: u64, name: &str, reason: &str) {
        let removed = {
            let mut st = self.state.lock().unwrap();
            if st.links.get(peer_id).is_some_and(|l| l.conn == conn) {
                st.links.remove(peer_id)
            } else {
                None // replaced by another connection, or the session was left
            }
        };
        let Some(link) = removed else { return };
        self.inbox.push(SyncEvent::Down {
            peer: peer_id.to_string(),
            reason: reason.to_string(),
        });
        self.refresh_peer_outputs();
        self.links_changed.notify_waiters();
        self.log(
            DebugKind::Info,
            peer_id,
            Some(link.remote),
            format!("{name} disconnected: {reason}"),
        );
        self.emit();
    }
}

/// Listens on `port`; if it is taken, on any free port (and says so).
async fn bind(ip: IpAddr, port: u16) -> (Option<TcpListener>, Option<String>) {
    match TcpListener::bind((ip, port)).await {
        Ok(listener) => (Some(listener), None),
        Err(e) if port != 0 => match TcpListener::bind((ip, 0)).await {
            Ok(listener) => {
                let actual = listener.local_addr().map(|a| a.port()).unwrap_or(0);
                (
                    Some(listener),
                    Some(format!(
                        "port {port} is unavailable ({e}); listening on {actual} instead"
                    )),
                )
            }
            Err(e) => (None, Some(format!("could not listen for sync: {e}"))),
        },
        Err(e) => (None, Some(format!("could not listen for sync: {e}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_port_parsing() {
        assert_eq!(
            parse_host_port(" 192.168.1.2:9701 ").unwrap(),
            ("192.168.1.2".into(), 9701)
        );
        assert_eq!(parse_host_port("[::1]:9701").unwrap(), ("::1".into(), 9701));
        assert_eq!(
            parse_host_port("studio.local:1").unwrap(),
            ("studio.local".into(), 1)
        );
        assert!(parse_host_port("studio.local").is_err());
        assert!(parse_host_port(":9701").is_err());
        assert!(parse_host_port("host:0").is_err());
        assert!(parse_host_port("host:99999").is_err());
    }

    #[test]
    fn names_are_cleaned() {
        assert_eq!(clean_name("  Bob\u{0007} "), "Bob");
        assert_eq!(clean_name(""), "OscOctopus");
        assert_eq!(clean_name(&"x".repeat(100)).chars().count(), MAX_NAME_CHARS);
    }
}
