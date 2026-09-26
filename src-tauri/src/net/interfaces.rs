use std::net::{IpAddr, Ipv4Addr};

use serde::Serialize;
use ts_rs::TS;

/// A local network interface address, used by the UI to offer bind addresses and
/// directed-broadcast targets. Nothing is chosen automatically.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct NetInterface {
    pub name: String,
    pub ip: String,
    pub prefix_len: u8,
    pub netmask: String,
    /// IPv4 directed broadcast address for this subnet, if it has one.
    pub broadcast: Option<String>,
    pub is_loopback: bool,
    pub is_ipv6: bool,
    pub is_up: bool,
}

pub fn list() -> std::io::Result<Vec<NetInterface>> {
    let mut out: Vec<NetInterface> = if_addrs::get_if_addrs()?
        .into_iter()
        .map(|iface| {
            let (prefix_len, netmask, broadcast) = match &iface.addr {
                if_addrs::IfAddr::V4(v4) => {
                    let computed = (v4.prefixlen < 31)
                        .then(|| Ipv4Addr::from(u32::from(v4.ip) | !u32::from(v4.netmask)));
                    (
                        v4.prefixlen,
                        v4.netmask.to_string(),
                        v4.broadcast.or(computed).map(|b| b.to_string()),
                    )
                }
                if_addrs::IfAddr::V6(v6) => (v6.prefixlen, v6.netmask.to_string(), None),
            };
            let ip = iface.ip();
            NetInterface {
                is_loopback: iface.is_loopback(),
                is_ipv6: matches!(ip, IpAddr::V6(_)),
                is_up: iface.is_oper_up(),
                name: iface.name,
                ip: ip.to_string(),
                prefix_len,
                netmask,
                broadcast,
            }
        })
        .collect();
    // IPv4 first, loopback last: the order a user is most likely to want.
    out.sort_by_key(|i| (i.is_ipv6, i.is_loopback, i.name.clone()));
    Ok(out)
}
