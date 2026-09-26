//! Input mapping transport, end to end on 127.0.0.1: what reaches the input hub (and what
//! doesn't), and forwarding never going back to its sender.

mod common;

use std::net::UdpSocket;
use std::time::Duration;

use common::{free_tcp_port, free_udp_port, manager, packets, wait_for};
use osc_octopus_lib::debug::Direction;
use osc_octopus_lib::input::{Avoid, Origin, INPUT_QUEUE_CAP};
use osc_octopus_lib::net::{
    EndpointState, InputConfig, NetworkConfig, NetworkManager, OutputConfig, Transport,
};
use osc_octopus_lib::osc::{encode_message, OscArg, OscMessage};
use rosc::{OscBundle, OscPacket, OscTime, OscType};

const D: &str = "desk-1";

fn message(address: &str) -> OscMessage {
    OscMessage {
        address: address.into(),
        args: vec![OscArg::Float(0.5)],
    }
}

fn udp_input(id: &str, port: u16) -> InputConfig {
    InputConfig {
        id: id.into(),
        bind_address: "127.0.0.1".into(),
        port,
        ..Default::default()
    }
}

fn udp_output(id: &str, port: u16) -> OutputConfig {
    OutputConfig {
        id: id.into(),
        host: "127.0.0.1".into(),
        port,
        ..Default::default()
    }
}

/// A manager with one UDP input listened to by input mapping, gate open.
async fn listening(
    port: u16,
) -> (
    NetworkManager,
    std::sync::Arc<osc_octopus_lib::debug::DebugHub>,
) {
    let (net, debug) = manager();
    let config = NetworkConfig {
        inputs: vec![udp_input("in", port)],
        outputs: vec![],
    };
    net.apply(D, config).await.unwrap();
    net.input().set_listen(D, vec!["in".into()]);
    net.input().set_enabled(true);
    (net, debug)
}

fn send_external(port: u16, bytes: &[u8]) -> UdpSocket {
    let sock = UdpSocket::bind("127.0.0.1:0").unwrap();
    sock.send_to(bytes, ("127.0.0.1", port)).unwrap();
    sock
}

#[tokio::test(flavor = "multi_thread")]
async fn an_external_sender_reaches_input_mapping_with_its_traffic_seq() {
    let port = free_udp_port();
    let (net, debug) = listening(port).await;
    let _sender = send_external(port, &encode_message(&message("/fader/1")).unwrap());

    let event = wait_for("inbound packet", || {
        packets(&debug, "in", Direction::In).pop()
    })
    .await;
    assert_eq!(event.origin, None);
    let batch = net.input().drain().expect("offered");
    let [m] = batch.messages.as_slice() else {
        panic!("one message expected, got {:?}", batch.messages)
    };
    assert_eq!(
        (m.seq, m.desk.as_str(), m.endpoint_id.as_str()),
        (event.seq, D, "in")
    );
    assert_eq!(m.address, "/fader/1");
    assert_eq!(m.args, vec![OscArg::Float(0.5)]);
}

#[tokio::test(flavor = "multi_thread")]
async fn this_apps_own_output_is_tagged_and_never_offered() {
    // The first-run desk: an output aimed at this app's own input.
    let port = free_udp_port();
    let (net, debug) = listening(port).await;
    let config = NetworkConfig {
        inputs: vec![udp_input("in", port)],
        outputs: vec![udp_output("out", port)],
    };
    net.apply(D, config).await.unwrap();
    net.send(D, &["out".into()], &message("/fader/1"), None, None)
        .await
        .unwrap();

    let event = wait_for("inbound packet", || {
        packets(&debug, "in", Direction::In).pop()
    })
    .await;
    assert_eq!(event.origin, Some(Origin::App));
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(
        net.input().drain().is_none(),
        "own packets never drive widgets"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_tcp_output_into_this_apps_own_tcp_input_is_ours() {
    let (net, debug) = manager();
    let port = free_tcp_port();
    let config = NetworkConfig {
        inputs: vec![InputConfig {
            transport: Transport::Tcp,
            ..udp_input("in", port)
        }],
        outputs: vec![OutputConfig {
            transport: Transport::Tcp,
            reconnect_ms: 100,
            ..udp_output("out", port)
        }],
    };
    net.apply(D, config).await.unwrap();
    net.input().set_listen(D, vec!["in".into()]);
    net.input().set_enabled(true);
    wait_for("tcp connect", || {
        (net.status_of(D, "out")?.state == EndpointState::Ready).then_some(())
    })
    .await;
    net.send(D, &["out".into()], &message("/x"), None, None)
        .await
        .unwrap();

    let event = wait_for("inbound packet", || {
        packets(&debug, "in", Direction::In).pop()
    })
    .await;
    assert_eq!(event.origin, Some(Origin::App));
    assert!(net.input().drain().is_none());
}

#[tokio::test(flavor = "multi_thread")]
async fn replies_on_an_output_socket_carry_the_output_id() {
    // A device that answers every message to the sender's port (X32 style).
    let device = UdpSocket::bind("127.0.0.1:0").unwrap();
    let device_port = device.local_addr().unwrap().port();
    std::thread::spawn(move || {
        let mut buf = [0u8; 1024];
        if let Ok((n, from)) = device.recv_from(&mut buf) {
            let _ = device.send_to(&buf[..n], from);
        }
    });

    let (net, debug) = manager();
    let config = NetworkConfig {
        outputs: vec![udp_output("out", device_port)],
        inputs: vec![],
    };
    net.apply(D, config).await.unwrap();
    net.input().set_listen(D, vec!["out".into()]);
    net.input().set_enabled(true);
    net.send(D, &["out".into()], &message("/ch/1/fader"), None, None)
        .await
        .unwrap();

    wait_for("reply", || packets(&debug, "out", Direction::In).pop()).await;
    let batch = net.input().drain().expect("reply offered");
    assert_eq!(batch.messages[0].endpoint_id, "out");
    assert_eq!(batch.messages[0].address, "/ch/1/fader");
}

#[tokio::test(flavor = "multi_thread")]
async fn nothing_is_offered_with_the_gate_closed_or_nobody_listening() {
    let port = free_udp_port();
    let (net, debug) = listening(port).await;

    net.input().set_enabled(false);
    let _a = send_external(port, &encode_message(&message("/a")).unwrap());
    wait_for("first packet", || {
        packets(&debug, "in", Direction::In).pop()
    })
    .await;
    assert!(net.input().drain().is_none(), "gate closed");

    net.input().set_enabled(true);
    net.input().set_listen(D, vec![]);
    let _b = send_external(port, &encode_message(&message("/b")).unwrap());
    wait_for("second packet", || {
        (packets(&debug, "in", Direction::In).len() >= 2).then_some(())
    })
    .await;
    assert!(
        net.input().drain().is_none(),
        "nobody listens to this input"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_bundle_arrives_in_order_in_one_batch() {
    let port = free_udp_port();
    let (net, debug) = listening(port).await;
    let msg = |addr: &str, v: f32| {
        OscPacket::Message(rosc::OscMessage {
            addr: addr.into(),
            args: vec![OscType::Float(v)],
        })
    };
    let bundle = OscPacket::Bundle(OscBundle {
        timetag: OscTime {
            seconds: 0,
            fractional: 1,
        },
        content: vec![msg("/x", 0.1), msg("/y", 0.2), msg("/z", 0.3)],
    });
    let _sender = send_external(port, &rosc::encoder::encode(&bundle).unwrap());

    wait_for("bundle", || packets(&debug, "in", Direction::In).pop()).await;
    let batch = net.input().drain().expect("offered");
    let addresses: Vec<&str> = batch.messages.iter().map(|m| m.address.as_str()).collect();
    assert_eq!(addresses, ["/x", "/y", "/z"]);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_flood_is_bounded_and_counted() {
    let port = free_udp_port();
    let (net, _debug) = listening(port).await;
    let sock = UdpSocket::bind("127.0.0.1:0").unwrap();
    let bytes = encode_message(&message("/flood")).unwrap();
    for _ in 0..3000 {
        let _ = sock.send_to(&bytes, ("127.0.0.1", port));
    }
    // UDP may lose some of the burst locally; compare with what actually arrived.
    tokio::time::sleep(Duration::from_millis(500)).await;
    let received = net.status_of(D, "in").unwrap().stats.rx_packets;
    let batch = net.input().drain().expect("offered");
    assert!(batch.messages.len() <= INPUT_QUEUE_CAP);
    assert_eq!(batch.messages.len() as u64 + batch.dropped, received);
    assert!(
        received > INPUT_QUEUE_CAP as u64,
        "burst larger than the queue"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn forwarding_never_goes_back_to_the_sender() {
    let port = free_udp_port();
    let (net, debug) = manager();
    let config = NetworkConfig {
        outputs: vec![udp_output("out", port)],
        inputs: vec![],
    };
    net.apply(D, config).await.unwrap();

    // The input came from the very address this output sends to: skipped.
    let back = Avoid {
        endpoint_id: Some("in".into()),
        remote: Some(format!("127.0.0.1:{port}")),
    };
    net.send(D, &["out".into()], &message("/f"), None, Some(&back))
        .await
        .unwrap();
    // The input arrived on this output (a reply): skipped.
    let replied = Avoid {
        endpoint_id: Some("out".into()),
        remote: None,
    };
    net.send(D, &["out".into()], &message("/f"), None, Some(&replied))
        .await
        .unwrap();
    assert!(packets(&debug, "out", Direction::Out).is_empty());
    assert_eq!(net.status_of(D, "out").unwrap().stats.tx_packets, 0);
    let notes: Vec<String> = debug
        .history()
        .into_iter()
        .filter_map(|e| e.message.filter(|m| m.starts_with("not forwarded")))
        .collect();
    assert_eq!(notes.len(), 2, "each skip is logged: {notes:?}");

    // From somewhere else on this machine (another port): sent.
    let elsewhere = Avoid {
        endpoint_id: Some("in".into()),
        remote: Some("127.0.0.1:1".into()),
    };
    net.send(D, &["out".into()], &message("/f"), None, Some(&elsewhere))
        .await
        .unwrap();
    assert_eq!(net.status_of(D, "out").unwrap().stats.tx_packets, 1);
}
