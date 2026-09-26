use std::net::{IpAddr, SocketAddr};

use tokio::task::JoinHandle;

/// Background tasks owned by an endpoint; aborted (closing their sockets) when dropped.
#[derive(Default)]
pub(crate) struct TaskGroup(Vec<JoinHandle<()>>);

impl TaskGroup {
    pub fn push(&mut self, handle: JoinHandle<()>) {
        self.0.push(handle);
    }
}

impl Drop for TaskGroup {
    fn drop(&mut self) {
        for handle in &self.0 {
            handle.abort();
        }
    }
}

pub(crate) fn parse_ip(field: &str, value: &str) -> Result<IpAddr, String> {
    value
        .trim()
        .parse()
        .map_err(|_| format!("{field} '{value}' is not a valid IP address"))
}

/// Resolves a host (IP literal or DNS name) to one socket address, preferring IPv4 because
/// most OSC gear is IPv4-only.
pub(crate) async fn resolve(host: &str, port: u16) -> Result<SocketAddr, String> {
    let host = host.trim();
    if let Ok(ip) = host.parse::<IpAddr>() {
        return Ok(SocketAddr::new(ip, port));
    }
    let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host, port))
        .await
        .map_err(|e| format!("could not resolve '{host}': {e}"))?
        .collect();
    addrs
        .iter()
        .find(|a| a.is_ipv4())
        .or_else(|| addrs.first())
        .copied()
        .ok_or_else(|| format!("'{host}' resolved to no addresses"))
}

/// Matches an unspecified bind address to the target's address family.
pub(crate) fn bind_for(bind: IpAddr, target: &SocketAddr, port: u16) -> SocketAddr {
    let ip = match (bind, target) {
        (IpAddr::V4(v4), SocketAddr::V6(_)) if v4.is_unspecified() => {
            IpAddr::V6(std::net::Ipv6Addr::UNSPECIFIED)
        }
        _ => bind,
    };
    SocketAddr::new(ip, port)
}
