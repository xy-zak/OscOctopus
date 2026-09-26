//! Sync managers talking to each other over 127.0.0.1, with LAN discovery off and short
//! timeouts. Keys are raw 32-byte PSKs (key derivation is tested in `identity.rs`).

mod common;

use std::net::{IpAddr, Ipv4Addr};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

use common::{free_tcp_port, wait_for};
use osc_octopus_lib::debug::DebugHub;
use osc_octopus_lib::input::InputHub;
use osc_octopus_lib::sync::wire::AppKind;
use osc_octopus_lib::sync::{
    PeerState, PeerStatus, SyncConfig, SyncEvent, SyncManager, SyncOptions,
};

const SCHEMA: u32 = 8;
const KEY: [u8; 32] = [7; 32];

struct App {
    sync: SyncManager,
    debug: Arc<DebugHub>,
    events: Mutex<Vec<SyncEvent>>,
    dir: PathBuf,
}

impl Drop for App {
    fn drop(&mut self) {
        self.sync.leave();
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

async fn app(name: &str) -> App {
    app_on(name, 0).await
}

/// An app that listens on `port` (0: any free port) once it joins.
async fn app_on(name: &str, port: u16) -> App {
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    let dir = std::env::temp_dir().join(format!(
        "osc-octopus-sync-{}-{}-{name}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = std::fs::remove_dir_all(&dir);
    let mut opts = SyncOptions::new(dir.clone());
    opts.bind_ip = IpAddr::V4(Ipv4Addr::LOCALHOST);
    opts.allow_discovery = false;
    opts.handshake_timeout = Duration::from_millis(500);
    opts.heartbeat = Duration::from_millis(200);
    opts.peer_timeout = Duration::from_millis(1500);
    opts.write_timeout = Duration::from_millis(500);
    opts.min_backoff = Duration::from_millis(50);
    opts.max_backoff = Duration::from_millis(200);
    let debug = Arc::new(DebugHub::new(10_000, 10_000));
    let sync = SyncManager::new(
        opts,
        debug.clone(),
        Arc::new(InputHub::new(1024)),
        Arc::new(|_| {}),
    );
    sync.set_profile(name, 1);
    sync.set_config(SyncConfig {
        port,
        discovery: false,
        manual_peers: vec![],
    })
    .await
    .unwrap();
    App {
        sync,
        debug,
        events: Mutex::default(),
        dir,
    }
}

impl App {
    /// Joins and returns the port it listens on.
    async fn join(&self, session: &str, key: [u8; 32], schema: u32) -> u16 {
        self.sync
            .join(session, key, schema)
            .await
            .listening
            .unwrap()
    }

    async fn dial(&self, port: u16) {
        let mut config = self.sync.status().config;
        config.manual_peers.push(format!("127.0.0.1:{port}"));
        self.sync.set_config(config).await.unwrap();
    }

    fn peers(&self) -> Vec<PeerStatus> {
        self.sync.status().peers
    }

    fn connected(&self) -> Vec<PeerStatus> {
        self.peers()
            .into_iter()
            .filter(|p| p.state == PeerState::Connected)
            .collect()
    }

    /// The error of a dialled address that was turned down.
    fn refusal(&self) -> Option<String> {
        self.peers()
            .into_iter()
            .find(|p| p.state == PeerState::Refused)
            .and_then(|p| p.last_error)
    }

    /// Every event received so far.
    fn events(&self) -> Vec<SyncEvent> {
        let mut events = self.events.lock().unwrap();
        if let Some(batch) = self.sync.drain() {
            events.extend(batch.events);
        }
        events.clone()
    }

    /// (kind, desk, body) of every message received so far.
    fn messages(&self) -> Vec<(AppKind, Option<String>, String)> {
        self.events()
            .into_iter()
            .filter_map(|e| match e {
                SyncEvent::Message {
                    kind, desk, body, ..
                } => Some((kind, desk, body.get().to_string())),
                _ => None,
            })
            .collect()
    }

    fn downs(&self) -> Vec<String> {
        self.events()
            .into_iter()
            .filter_map(|e| match e {
                SyncEvent::Down { reason, .. } => Some(reason),
                _ => None,
            })
            .collect()
    }

    fn logged(&self, text: &str) -> bool {
        self.debug
            .history()
            .iter()
            .any(|e| e.message.as_deref().is_some_and(|m| m.contains(text)))
    }
}

/// Two apps in the same session, `a` dialling `b`, both connected.
async fn connected_pair() -> (App, App) {
    let (a, b) = (app("a").await, app("b").await);
    a.join("Stage", KEY, SCHEMA).await;
    let port_b = b.join("Stage", KEY, SCHEMA).await;
    a.dial(port_b).await;
    wait_for("a connected", || (a.connected().len() == 1).then_some(())).await;
    wait_for("b connected", || (b.connected().len() == 1).then_some(())).await;
    (a, b)
}

#[tokio::test(flavor = "multi_thread")]
async fn peers_authenticate_and_exchange_messages() {
    let (a, b) = connected_pair().await;
    let seen_by_a = &a.connected()[0];
    assert_eq!(seen_by_a.peer_id.as_deref(), Some(b.sync.peer_id()));
    assert_eq!(seen_by_a.name.as_deref(), Some("b"));
    assert!(matches!(&b.events()[0], SyncEvent::Up { peer } if peer.peer_id == a.sync.peer_id()));

    b.sync.set_desks(vec!["desk-1".into()]);
    let sent = a
        .sync
        .send(None, AppKind::DeskOps, Some("desk-1"), r#"{"n":1}"#)
        .unwrap();
    assert_eq!(sent, 1);
    let got = wait_for("message", || b.messages().into_iter().next()).await;
    assert_eq!(
        got,
        (AppKind::DeskOps, Some("desk-1".into()), r#"{"n":1}"#.into())
    );

    // A heartbeat measured the round trip.
    wait_for("rtt", || a.connected()[0].rtt_ms).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_wrong_key_is_refused() {
    let (a, b) = (app("a").await, app("b").await);
    a.join("Stage", KEY, SCHEMA).await;
    let port_b = b.join("Stage", [8; 32], SCHEMA).await;
    a.dial(port_b).await;
    let error = wait_for("refusal", || a.refusal()).await;
    assert!(error.contains("wrong session key"), "{error}");
    assert!(a.connected().is_empty() && b.connected().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn another_session_is_refused() {
    let (a, b) = (app("a").await, app("b").await);
    a.join("Stage", KEY, SCHEMA).await;
    let port_b = b.join("Studio", KEY, SCHEMA).await;
    a.dial(port_b).await;
    let error = wait_for("refusal", || a.refusal()).await;
    assert!(error.contains("different session name"), "{error}");
}

#[tokio::test(flavor = "multi_thread")]
async fn another_desk_format_is_refused() {
    let (a, b) = (app("a").await, app("b").await);
    a.join("Stage", KEY, SCHEMA).await;
    let port_b = b.join("Stage", KEY, SCHEMA + 1).await;
    a.dial(port_b).await;
    let error = wait_for("refusal", || a.refusal()).await;
    assert!(error.contains("desk format v8 here, v9"), "{error}");
    assert!(b.connected().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn dialling_itself_is_detected() {
    let a = app("a").await;
    let port = a.join("Stage", KEY, SCHEMA).await;
    a.dial(port).await;
    let error = wait_for("refusal", || a.refusal()).await;
    assert!(error.contains("own address"), "{error}");
    assert!(a.connected().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn two_way_dialling_keeps_one_connection_and_loses_nothing() {
    let (a, b) = (app("a").await, app("b").await);
    let port_a = a.join("Stage", KEY, SCHEMA).await;
    let port_b = b.join("Stage", KEY, SCHEMA).await;
    a.dial(port_b).await;
    b.dial(port_a).await;
    wait_for("a connected", || (a.connected().len() == 1).then_some(())).await;
    wait_for("b connected", || (b.connected().len() == 1).then_some(())).await;
    tokio::time::sleep(Duration::from_millis(600)).await;
    assert_eq!(a.connected().len(), 1);
    assert_eq!(b.connected().len(), 1);

    b.sync.set_desks(vec!["d".into()]);
    for n in 0..100 {
        let sent = a
            .sync
            .send(None, AppKind::DeskOps, Some("d"), &n.to_string())
            .unwrap();
        assert_eq!(sent, 1);
    }
    wait_for("100 messages", || (b.messages().len() >= 100).then_some(())).await;
    tokio::time::sleep(Duration::from_millis(200)).await;
    let bodies: Vec<String> = b.messages().into_iter().map(|m| m.2).collect();
    let expected: Vec<String> = (0..100).map(|n: i32| n.to_string()).collect();
    assert_eq!(bodies, expected, "each exactly once, in order");
}

#[tokio::test(flavor = "multi_thread")]
async fn large_messages_arrive_whole() {
    let (a, b) = connected_pair().await;
    b.sync.set_desks(vec!["d".into()]);
    let body = format!("\"{}\"", "x".repeat(3_000_000));
    a.sync
        .send(None, AppKind::DeskState, Some("d"), &body)
        .unwrap();
    let got = wait_for("desk state", || b.messages().into_iter().next()).await;
    assert_eq!(got.2.len(), body.len());
    assert_eq!(got.2, body);
}

#[tokio::test(flavor = "multi_thread")]
async fn messages_for_desks_not_shared_here_are_dropped() {
    let (a, b) = connected_pair().await;
    b.sync.set_desks(vec!["shared".into()]);
    a.sync
        .send(None, AppKind::DeskOps, Some("other"), "1")
        .unwrap();
    a.sync
        .send(None, AppKind::DeskOps, Some("shared"), "2")
        .unwrap();
    a.sync.send(None, AppKind::Presence, None, "3").unwrap();
    wait_for("presence", || (b.messages().len() >= 2).then_some(())).await;
    let bodies: Vec<String> = b.messages().into_iter().map(|m| m.2).collect();
    assert_eq!(bodies, ["2", "3"]);
}

#[tokio::test(flavor = "multi_thread")]
async fn leaving_says_goodbye_and_rejoining_reconnects() {
    let port_b = free_tcp_port();
    let (a, b) = (app("a").await, app_on("b", port_b).await);
    a.join("Stage", KEY, SCHEMA).await;
    assert_eq!(b.join("Stage", KEY, SCHEMA).await, port_b);
    a.dial(port_b).await;
    wait_for("connected", || (a.connected().len() == 1).then_some(())).await;

    b.sync.leave();
    let reason = wait_for("down", || a.downs().into_iter().next()).await;
    assert_eq!(reason, "left the session");
    assert!(a.connected().is_empty());

    b.join("Stage", KEY, SCHEMA).await;
    wait_for("reconnected", || (a.connected().len() == 1).then_some(())).await;
    let ups = a
        .events()
        .iter()
        .filter(|e| matches!(e, SyncEvent::Up { .. }))
        .count();
    assert_eq!(ups, 2);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_blocked_device_is_disconnected_and_kept_out() {
    let (a, b) = connected_pair().await;
    a.sync.set_blocked(vec![b.sync.peer_id().to_string()]);
    let reason = wait_for("b told", || b.downs().into_iter().next()).await;
    assert!(reason.contains("blocked"), "{reason}");
    let error = wait_for("redial refused", || a.refusal()).await;
    assert!(error.contains("blocked"), "{error}");
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(a.connected().is_empty() && b.connected().is_empty());
    assert_eq!(a.sync.status().blocked, [b.sync.peer_id()]);
}

#[tokio::test(flavor = "multi_thread")]
async fn repeated_failed_attempts_get_an_ip_ignored() {
    let a = app("a").await;
    let port = a.join("Stage", KEY, SCHEMA).await;
    for _ in 0..5 {
        let mut s = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        s.write_all(b"GET / HTTP/1.1\r\nHost: x\r\n\r\n")
            .await
            .unwrap();
        let mut buf = Vec::new();
        let _ = s.read_to_end(&mut buf).await;
    }
    wait_for("ban", || a.logged("ignoring 127.0.0.1").then_some(())).await;

    // Even a device with the right key is ignored from that IP for now.
    let b = app("b").await;
    b.join("Stage", KEY, SCHEMA).await;
    b.dial(port).await;
    tokio::time::sleep(Duration::from_millis(800)).await;
    assert!(b.connected().is_empty());
    assert!(a.connected().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_silent_connection_is_dropped_after_the_handshake_timeout() {
    let a = app("a").await;
    let port = a.join("Stage", KEY, SCHEMA).await;
    let mut s = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    let started = Instant::now();
    let mut buf = Vec::new();
    let _ = s.read_to_end(&mut buf).await; // the preamble, then EOF
    assert!(
        started.elapsed() < Duration::from_secs(2),
        "{:?}",
        started.elapsed()
    );
    assert!(a.logged("timed out"));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_burst_beyond_the_rate_limit_is_trimmed_not_fatal() {
    let (a, b) = connected_pair().await;
    for _ in 0..5 {
        for n in 0..200 {
            a.sync
                .send(None, AppKind::Presence, None, &n.to_string())
                .unwrap();
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    tokio::time::sleep(Duration::from_millis(500)).await;
    let received = b.messages().len();
    assert!((500..1000).contains(&received), "{received}");
    let rejected = b.connected()[0].stats.rejected;
    assert!(rejected > 0);
    assert_eq!(a.connected().len(), 1, "still connected");
}
