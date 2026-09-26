//! End-to-end: real sockets on 127.0.0.1, an output sending to an input of the same manager.
//! Asserts the bytes recorded as sent are exactly the bytes recorded as received.

use std::sync::Arc;
use std::time::{Duration, Instant};

use osc_octopus_lib::debug::{DebugEvent, DebugHub, DebugKind, Direction};
use osc_octopus_lib::net::{
    EndpointState, InputConfig, NetworkConfig, NetworkManager, OutputConfig, TcpFraming, Transport,
    UdpMode,
};
use osc_octopus_lib::osc::{encode_message, OscArg, OscMessage};

/// Default desk used by single-desk tests.
const D: &str = "desk-1";

fn manager() -> (NetworkManager, Arc<DebugHub>) {
    let debug = Arc::new(DebugHub::new(10_000, 10_000));
    let net = NetworkManager::new(debug.clone(), Arc::new(|_| {}), Arc::new(|_| {}));
    (net, debug)
}

fn free_udp_port() -> u16 {
    std::net::UdpSocket::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

fn free_tcp_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

fn message() -> OscMessage {
    OscMessage {
        address: "/desk/fader/1".into(),
        args: vec![
            OscArg::Float(0.75),
            OscArg::Int(3),
            OscArg::String("hi".into()),
        ],
    }
}

async fn wait_for<T>(what: &str, mut f: impl FnMut() -> Option<T>) -> T {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if let Some(v) = f() {
            return v;
        }
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

fn packets(debug: &DebugHub, endpoint: &str, dir: Direction) -> Vec<DebugEvent> {
    debug
        .history()
        .into_iter()
        .filter(|e| {
            e.kind == DebugKind::Packet && e.endpoint_id == endpoint && e.direction == Some(dir)
        })
        .collect()
}

async fn assert_round_trip(net: &NetworkManager, debug: &DebugHub, out_id: &str, in_id: &str) {
    net.send(D, &[out_id.to_string()], &message(), Some("widget-1"))
        .await
        .unwrap();
    let received = wait_for("inbound packet", || {
        packets(debug, in_id, Direction::In).pop()
    })
    .await;
    let sent = packets(debug, out_id, Direction::Out)
        .pop()
        .expect("outbound event");
    let expected = encode_message(&message()).unwrap();
    assert_eq!(sent.error, None);
    assert_eq!(sent.source.as_deref(), Some("widget-1"));
    assert_eq!(sent.bytes, expected);
    assert_eq!(received.bytes, expected);
    assert!(
        received.decoded.is_some(),
        "decode error: {:?}",
        received.decode_error
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn udp_unicast_round_trip() {
    let (net, debug) = manager();
    let port = free_udp_port();
    net.apply(
        D,
        NetworkConfig {
            inputs: vec![InputConfig {
                id: "in".into(),
                bind_address: "127.0.0.1".into(),
                port,
                ..Default::default()
            }],
            outputs: vec![OutputConfig {
                id: "out".into(),
                host: "127.0.0.1".into(),
                port,
                ..Default::default()
            }],
        },
    )
    .await
    .unwrap();
    assert_eq!(net.status_of(D, "out").unwrap().state, EndpointState::Ready);
    assert_eq!(net.status_of(D, "in").unwrap().state, EndpointState::Ready);
    assert_round_trip(&net, &debug, "out", "in").await;
    assert_eq!(net.status_of(D, "out").unwrap().stats.tx_packets, 1);
}

async fn tcp_round_trip(framing: TcpFraming) {
    let (net, debug) = manager();
    let port = free_tcp_port();
    net.apply(
        D,
        NetworkConfig {
            inputs: vec![InputConfig {
                id: "in".into(),
                transport: Transport::Tcp,
                bind_address: "127.0.0.1".into(),
                port,
                framing,
                ..Default::default()
            }],
            outputs: vec![OutputConfig {
                id: "out".into(),
                transport: Transport::Tcp,
                host: "127.0.0.1".into(),
                port,
                framing,
                reconnect_ms: 100,
                ..Default::default()
            }],
        },
    )
    .await
    .unwrap();
    wait_for("tcp connect", || {
        (net.status_of(D, "out")?.state == EndpointState::Ready).then_some(())
    })
    .await;
    assert_round_trip(&net, &debug, "out", "in").await;
    let sent = packets(&debug, "out", Direction::Out).pop().unwrap();
    assert!(
        sent.wire_len.unwrap() as usize > sent.bytes.len(),
        "framing overhead counted"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn tcp_slip_round_trip() {
    tcp_round_trip(TcpFraming::Slip).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn tcp_length_prefix_round_trip() {
    tcp_round_trip(TcpFraming::LengthPrefix).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn tcp_output_reports_refused_connection() {
    let (net, debug) = manager();
    let port = free_tcp_port(); // nothing listens here
    net.apply(
        D,
        NetworkConfig {
            outputs: vec![OutputConfig {
                id: "out".into(),
                transport: Transport::Tcp,
                port,
                reconnect_ms: 100,
                ..Default::default()
            }],
            inputs: vec![],
        },
    )
    .await
    .unwrap();
    wait_for("error state", || {
        (net.status_of(D, "out")?.state == EndpointState::Error).then_some(())
    })
    .await;
    net.send(D, &["out".into()], &message(), None)
        .await
        .unwrap();
    let sent = wait_for("dropped packet event", || {
        packets(&debug, "out", Direction::Out).pop()
    })
    .await;
    assert!(sent.error.unwrap().contains("not connected"));
}

#[tokio::test(flavor = "multi_thread")]
async fn reconcile_keeps_unchanged_and_removes_deleted() {
    let (net, debug) = manager();
    let config = NetworkConfig {
        outputs: vec![OutputConfig {
            id: "a".into(),
            port: free_udp_port(),
            ..Default::default()
        }],
        inputs: vec![],
    };
    net.apply(D, config.clone()).await.unwrap();
    let local = net.status_of(D, "a").unwrap().local;
    net.apply(D, config).await.unwrap();
    assert_eq!(
        net.status_of(D, "a").unwrap().local,
        local,
        "unchanged output must not be rebound"
    );

    net.apply(D, NetworkConfig::default()).await.unwrap();
    assert!(net.status_of(D, "a").is_none());
    net.send(D, &["a".into()], &message(), None).await.unwrap();
    let last = debug.history().pop().unwrap();
    assert_eq!(last.kind, DebugKind::Error);
    assert!(last.error.unwrap().contains("no output"));
}

#[tokio::test(flavor = "multi_thread")]
async fn invalid_socket_options_surface_as_errors() {
    let (net, _debug) = manager();
    net.apply(
        D,
        NetworkConfig {
            outputs: vec![
                OutputConfig {
                    id: "mc".into(),
                    host: "127.0.0.1".into(),
                    mode: UdpMode::Multicast,
                    ..Default::default()
                },
                OutputConfig {
                    id: "bad-bind".into(),
                    bind_address: "not-an-ip".into(),
                    ..Default::default()
                },
            ],
            inputs: vec![],
        },
    )
    .await
    .unwrap();
    for id in ["mc", "bad-bind"] {
        let status = net.status_of(D, id).unwrap();
        assert_eq!(status.state, EndpointState::Error, "{id}");
        assert!(status.detail.is_some(), "{id} should explain the error");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn rejects_duplicate_ids() {
    let (net, _) = manager();
    let out = OutputConfig {
        id: "x".into(),
        ..Default::default()
    };
    let input = InputConfig {
        id: "x".into(),
        ..Default::default()
    };
    assert!(net
        .apply(
            D,
            NetworkConfig {
                outputs: vec![out],
                inputs: vec![input]
            }
        )
        .await
        .is_err());
}

#[tokio::test(flavor = "multi_thread")]
async fn pause_blocks_every_output_and_records_what_would_have_left() {
    let (net, debug) = manager();
    let port = free_udp_port();
    net.apply(
        D,
        NetworkConfig {
            inputs: vec![InputConfig {
                id: "in".into(),
                bind_address: "127.0.0.1".into(),
                port,
                ..Default::default()
            }],
            outputs: vec![OutputConfig {
                id: "out".into(),
                host: "127.0.0.1".into(),
                port,
                ..Default::default()
            }],
        },
    )
    .await
    .unwrap();

    assert!(net.set_paused(true));
    net.send(D, &["out".into()], &message(), Some("w"))
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(
        packets(&debug, "in", Direction::In).is_empty(),
        "nothing may reach the network while paused"
    );
    let blocked = packets(&debug, "out", Direction::Out).pop().unwrap();
    assert!(blocked.blocked);
    assert_eq!(blocked.bytes, encode_message(&message()).unwrap());
    let stats = net.status_of(D, "out").unwrap().stats;
    assert_eq!((stats.tx_packets, stats.blocked, stats.errors), (0, 1, 0));

    assert!(!net.set_paused(false));
    assert_round_trip(&net, &debug, "out", "in").await;
}

#[tokio::test(flavor = "multi_thread")]
async fn desks_are_independent_and_may_reuse_endpoint_ids() {
    let (net, _debug) = manager();
    let output = |port| NetworkConfig {
        outputs: vec![OutputConfig {
            id: "out".into(),
            port,
            ..Default::default()
        }],
        inputs: vec![],
    };
    net.apply("a", output(free_udp_port())).await.unwrap();
    net.apply("b", output(free_udp_port())).await.unwrap();
    assert_eq!(
        net.status_of("a", "out").unwrap().state,
        EndpointState::Ready
    );
    assert_eq!(
        net.status_of("b", "out").unwrap().state,
        EndpointState::Ready
    );
    let b_local = net.status_of("b", "out").unwrap().local;

    // Closing desk a must not touch desk b.
    net.close_desk("a").await.unwrap();
    assert!(net.status_of("a", "out").is_none());
    assert_eq!(net.status_of("b", "out").unwrap().local, b_local);
    assert_eq!(net.status().len(), 1);
}
