//! Network layer: user-configured OSC outputs and inputs over UDP and TCP.
//!
//! Nothing here is configured implicitly. Every socket option comes from `OutputConfig` /
//! `InputConfig`, and every state change is reported to the `StatusBoard` and the debug log.

mod ctx;
pub mod framing;
pub mod interfaces;
mod manager;
mod status;
mod tcp;
mod udp;
mod util;

pub use manager::NetworkManager;
pub use status::{
    EndpointKind, EndpointState, EndpointStats, EndpointStatus, StatusBoard, StatusListener,
};
pub use tcp::{MAX_TCP_CLIENTS, WRITE_TIMEOUT};
pub use util::{system_resolver, ResolveFuture, Resolver, RESOLVE_TIMEOUT};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Transport {
    #[default]
    Udp,
    Tcp,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum UdpMode {
    #[default]
    Unicast,
    /// Sets SO_BROADCAST. Use 255.255.255.255 or a directed broadcast address (e.g. 192.168.1.255).
    Broadcast,
    /// Target must be a multicast group (224.0.0.0/4 or ff00::/8).
    Multicast,
}

/// How OSC packets are delimited on a TCP stream.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum TcpFraming {
    /// OSC 1.1: SLIP (RFC 1055) double-END framing.
    #[default]
    Slip,
    /// OSC 1.0: each packet preceded by its int32 big-endian length.
    LengthPrefix,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct OutputConfig {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub transport: Transport,
    /// IP address or hostname of the receiver (or broadcast / multicast address).
    pub host: String,
    pub port: u16,
    /// UDP only.
    pub mode: UdpMode,
    /// Local address to send from. "0.0.0.0" lets the OS pick the interface.
    pub bind_address: String,
    /// Local source port. 0 lets the OS pick an ephemeral port.
    pub local_port: u16,
    /// UDP multicast only.
    pub multicast_ttl: u32,
    /// UDP multicast only: receive our own multicast packets on this host.
    pub multicast_loop: bool,
    /// TCP only.
    pub framing: TcpFraming,
    /// TCP only: delay between reconnect attempts.
    pub reconnect_ms: u32,
}

impl Default for OutputConfig {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            enabled: true,
            transport: Transport::Udp,
            host: "127.0.0.1".into(),
            port: 9000,
            mode: UdpMode::Unicast,
            bind_address: "0.0.0.0".into(),
            local_port: 0,
            multicast_ttl: 1,
            multicast_loop: true,
            framing: TcpFraming::Slip,
            reconnect_ms: 1000,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct InputConfig {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub transport: Transport,
    /// Local address to listen on. "0.0.0.0" listens on all IPv4 interfaces.
    pub bind_address: String,
    pub port: u16,
    /// UDP only: multicast group to join (e.g. "239.0.0.1").
    pub multicast_group: Option<String>,
    /// TCP only.
    pub framing: TcpFraming,
}

impl Default for InputConfig {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            enabled: true,
            transport: Transport::Udp,
            bind_address: "0.0.0.0".into(),
            port: 9001,
            multicast_group: None,
            framing: TcpFraming::Slip,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct NetworkConfig {
    pub outputs: Vec<OutputConfig>,
    pub inputs: Vec<InputConfig>,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Endpoint defaults are owned here, like the types. `npm run bindings` writes them next to
    /// the generated TS types, and `newOutput()` / `newInput()` in the frontend start from
    /// them, so the two sides can't drift.
    #[test]
    fn export_bindings_network_defaults() {
        let dir =
            std::env::var("TS_RS_EXPORT_DIR").unwrap_or_else(|_| "../src/lib/ipc/bindings".into());
        let defaults = serde_json::json!({
            "output": OutputConfig::default(),
            "input": InputConfig::default(),
        });
        let text = serde_json::to_string_pretty(&defaults).unwrap() + "\n";
        std::fs::write(std::path::Path::new(&dir).join("defaults.json"), text).unwrap();
    }
}
