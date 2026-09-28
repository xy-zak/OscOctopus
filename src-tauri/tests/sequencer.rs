//! End-to-end: a sequencer run sending through a real network manager, from an output to an
//! input of the same manager on 127.0.0.1.

mod common;

use std::sync::Arc;

use common::{free_udp_port, manager, packets, wait_for};
use osc_octopus_lib::debug::Direction;
use osc_octopus_lib::net::{InputConfig, NetworkConfig, NetworkManager, OutputConfig};
use osc_octopus_lib::osc::{OscArg, OscMessage, OscPacketView};
use osc_octopus_lib::sequencer::{SeqPlan, SeqStep, Sequencer};

const D: &str = "desk-1";

fn step(n: i32, delay_ms: u32) -> SeqStep {
    SeqStep {
        id: format!("s{n}"),
        message: OscMessage {
            address: "/cue".into(),
            args: vec![OscArg::Int(n)],
        },
        delay_ms,
    }
}

async fn looped_desk() -> (Arc<NetworkManager>, Arc<osc_octopus_lib::debug::DebugHub>) {
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
    (Arc::new(net), debug)
}

/// The first Int argument of each packet received on `in`.
fn received_cues(debug: &osc_octopus_lib::debug::DebugHub) -> Vec<i32> {
    packets(debug, "in", Direction::In)
        .into_iter()
        .filter_map(|e| match e.decoded {
            Some(OscPacketView::Message { args, .. }) => match args.first() {
                Some(OscArg::Int(n)) => Some(*n),
                _ => None,
            },
            _ => None,
        })
        .collect()
}

#[tokio::test(flavor = "multi_thread")]
async fn plays_its_steps_in_order_on_the_wire() {
    let (net, debug) = looped_desk().await;
    let seq = Arc::new(Sequencer::new(net.clone(), debug.clone()));
    let plan = SeqPlan {
        output_ids: vec!["out".into()],
        steps: vec![step(1, 20), step(2, 20), step(3, 20)],
        count: Some(2),
    };
    seq.start(D, "w-seq", plan).unwrap();
    let cues = wait_for("both passes", || {
        let c = received_cues(&debug);
        (c.len() >= 6).then_some(c)
    })
    .await;
    assert_eq!(cues, [1, 2, 3, 1, 2, 3]);
    let sent = packets(&debug, "out", Direction::Out);
    assert!(sent.iter().all(|e| e.source.as_deref() == Some("w-seq")));
}

#[tokio::test(flavor = "multi_thread")]
async fn osc_out_off_holds_every_step_back() {
    let (net, debug) = looped_desk().await;
    net.set_paused(true);
    let seq = Arc::new(Sequencer::new(net.clone(), debug.clone()));
    let plan = SeqPlan {
        output_ids: vec!["out".into()],
        steps: vec![step(1, 10), step(2, 10)],
        count: Some(1),
    };
    seq.start(D, "w-seq", plan).unwrap();
    let held = wait_for("two held packets", || {
        let h: Vec<_> = packets(&debug, "out", Direction::Out)
            .into_iter()
            .filter(|e| e.blocked)
            .collect();
        (h.len() >= 2).then_some(h)
    })
    .await;
    assert!(held.iter().all(|e| e.source.as_deref() == Some("w-seq")));
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    assert!(
        received_cues(&debug).is_empty(),
        "nothing reached the input"
    );
}
