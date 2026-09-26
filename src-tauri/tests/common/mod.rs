//! Helpers shared by the integration tests (each test file uses a subset).
#![allow(dead_code)]

use std::sync::Arc;
use std::time::{Duration, Instant};

use osc_octopus_lib::debug::{DebugEvent, DebugHub, DebugKind, Direction};
use osc_octopus_lib::net::NetworkManager;

pub fn manager() -> (NetworkManager, Arc<DebugHub>) {
    let debug = Arc::new(DebugHub::new(10_000, 10_000));
    let net = NetworkManager::new(debug.clone(), Arc::new(|_| {}));
    (net, debug)
}

pub fn free_udp_port() -> u16 {
    std::net::UdpSocket::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

pub fn free_tcp_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

/// Polls `f` every 20 ms until it returns `Some`, failing after 5 s.
pub async fn wait_for<T>(what: &str, mut f: impl FnMut() -> Option<T>) -> T {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if let Some(v) = f() {
            return v;
        }
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

/// Packet events of one endpoint in one direction, oldest first.
pub fn packets(debug: &DebugHub, endpoint: &str, dir: Direction) -> Vec<DebugEvent> {
    debug
        .history()
        .into_iter()
        .filter(|e| {
            e.kind == DebugKind::Packet && e.endpoint_id == endpoint && e.direction == Some(dir)
        })
        .collect()
}
