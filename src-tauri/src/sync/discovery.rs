//! LAN discovery over mDNS-SD (`_oscoctopus._tcp`): each app in a session advertises its sync
//! port and browses for the others. The TXT record carries only the protocol version, a random
//! per-launch id and a short hash of the session name. It has no device name and no stable id,
//! so nothing on the LAN can track a device across launches. Manual peers work without it.

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};

use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};

use super::identity::to_hex;
use super::wire::PROTOCOL;

pub const SERVICE_TYPE: &str = "_oscoctopus._tcp.local.";

pub enum Found {
    /// A peer app in the same session, by its mDNS full name, and where it listens.
    Up {
        key: String,
        addrs: Vec<SocketAddr>,
    },
    Down {
        key: String,
    },
}

/// Advertises and browses until dropped.
pub struct Discovery {
    daemon: ServiceDaemon,
    fullname: String,
}

impl Discovery {
    pub fn start(
        port: u16,
        instance_id: &str,
        session_hash: &[u8; 8],
        on_found: impl Fn(Found) + Send + 'static,
    ) -> Result<Self, String> {
        let err = |e: mdns_sd::Error| format!("LAN discovery unavailable: {e}");
        let daemon = ServiceDaemon::new().map_err(err)?;
        let session = to_hex(&session_hash[..4]);
        let version = PROTOCOL.0.to_string();
        let props: HashMap<String, String> = [
            ("v".to_string(), version.clone()),
            ("iid".to_string(), instance_id.to_string()),
            ("s".to_string(), session.clone()),
        ]
        .into();
        let name = format!("octopus-{instance_id}");
        let info = ServiceInfo::new(
            SERVICE_TYPE,
            &name,
            &format!("{name}.local."),
            "",
            port,
            props,
        )
        .map_err(err)?
        .enable_addr_auto();
        let fullname = info.get_fullname().to_string();
        daemon.register(info).map_err(err)?;
        let events = daemon.browse(SERVICE_TYPE).map_err(err)?;
        let own = instance_id.to_string();
        tokio::spawn(async move {
            // Ends when the daemon shuts down (the channel closes).
            while let Ok(event) = events.recv_async().await {
                match event {
                    ServiceEvent::ServiceResolved(svc) => {
                        let prop = |k| svc.get_property_val_str(k);
                        if prop("iid") == Some(own.as_str())
                            || prop("s") != Some(session.as_str())
                            || prop("v") != Some(version.as_str())
                        {
                            continue;
                        }
                        let port = svc.get_port();
                        let mut addrs: Vec<SocketAddr> = svc
                            .get_addresses_v4()
                            .into_iter()
                            .map(|ip| SocketAddr::new(IpAddr::V4(ip), port))
                            .collect();
                        addrs.sort();
                        if !addrs.is_empty() {
                            on_found(Found::Up {
                                key: svc.get_fullname().to_string(),
                                addrs,
                            });
                        }
                    }
                    ServiceEvent::ServiceRemoved(_, fullname) => {
                        on_found(Found::Down { key: fullname })
                    }
                    _ => {}
                }
            }
        });
        Ok(Self { daemon, fullname })
    }
}

impl Drop for Discovery {
    fn drop(&mut self) {
        // Says goodbye on the LAN, then stops the daemon thread.
        let _ = self.daemon.unregister(&self.fullname);
        let _ = self.daemon.shutdown();
    }
}
