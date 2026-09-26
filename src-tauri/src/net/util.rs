use std::future::Future;
use std::net::{IpAddr, SocketAddr};
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use tokio::task::JoinHandle;

/// A hostname lookup that takes longer than this fails instead of stalling the endpoint.
pub const RESOLVE_TIMEOUT: Duration = Duration::from_secs(3);

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

pub type ResolveFuture = Pin<Box<dyn Future<Output = Result<SocketAddr, String>> + Send>>;

/// Turns (host, port) into one socket address. The network manager takes one so tests can
/// substitute a slow or failing lookup; the app uses [`system_resolver`].
pub type Resolver = Arc<dyn Fn(String, u16) -> ResolveFuture + Send + Sync>;

pub fn system_resolver() -> Resolver {
    Arc::new(|host, port| Box::pin(async move { resolve(&host, port).await }))
}

/// Resolves a host (IP literal or DNS name) to one socket address, preferring IPv4 because
/// most OSC gear is IPv4-only. Gives up after [`RESOLVE_TIMEOUT`].
pub(crate) async fn resolve(host: &str, port: u16) -> Result<SocketAddr, String> {
    let host = host.trim();
    if let Ok(ip) = host.parse::<IpAddr>() {
        return Ok(SocketAddr::new(ip, port));
    }
    let addrs: Vec<SocketAddr> =
        tokio::time::timeout(RESOLVE_TIMEOUT, tokio::net::lookup_host((host, port)))
            .await
            .map_err(|_| {
                format!(
                    "resolving '{host}' timed out after {}s",
                    RESOLVE_TIMEOUT.as_secs()
                )
            })?
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
