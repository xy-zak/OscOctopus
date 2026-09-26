use std::io::ErrorKind;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

use socket2::{Domain, Protocol, Socket, Type};
use tokio::net::UdpSocket;

use super::ctx::Ctx;
use super::status::EndpointState;
use super::util::{bind_for, parse_ip, resolve, TaskGroup};
use super::{InputConfig, OutputConfig, UdpMode};

/// Largest possible UDP payload.
const RECV_BUF: usize = 65_536;

pub(crate) struct UdpOutput {
    socket: Arc<UdpSocket>,
    target: SocketAddr,
    local: Option<SocketAddr>,
}

impl UdpOutput {
    pub async fn send(&self, ctx: &Ctx, bytes: &[u8], source: Option<&str>) {
        let result = match self.socket.send_to(bytes, self.target).await {
            Ok(n) if n == bytes.len() => Ok(()),
            Ok(n) => Err(format!("short write: {n} of {} bytes sent", bytes.len())),
            Err(e) => Err(e.to_string()),
        };
        ctx.packet_out(
            bytes,
            bytes.len(),
            self.local,
            self.target.to_string(),
            result,
            source,
        );
    }
}

fn socket_for(addr: &SocketAddr) -> std::io::Result<Socket> {
    Socket::new(Domain::for_address(*addr), Type::DGRAM, Some(Protocol::UDP))
}

fn into_tokio(socket: Socket) -> std::io::Result<UdpSocket> {
    socket.set_nonblocking(true)?;
    UdpSocket::from_std(socket.into())
}

pub(crate) async fn start_output(
    cfg: &OutputConfig,
    ctx: &Ctx,
    tasks: &mut TaskGroup,
) -> Result<UdpOutput, String> {
    let target = resolve(&cfg.host, cfg.port).await?;
    let bind_ip = parse_ip("bind address", &cfg.bind_address)?;
    let bind = bind_for(bind_ip, &target, cfg.local_port);

    match cfg.mode {
        UdpMode::Broadcast if !target.is_ipv4() => {
            return Err("broadcast requires an IPv4 target (IPv6 has no broadcast)".into())
        }
        UdpMode::Multicast if !target.ip().is_multicast() => {
            return Err(format!(
                "{} is not a multicast address (224.0.0.0/4 or ff00::/8)",
                target.ip()
            ))
        }
        _ => {}
    }

    let socket = socket_for(&bind).map_err(|e| format!("socket(): {e}"))?;
    let opt = |what: &str, r: std::io::Result<()>| r.map_err(|e| format!("{what}: {e}"));
    match (cfg.mode, target.ip(), bind.ip()) {
        (UdpMode::Broadcast, _, _) => opt("SO_BROADCAST", socket.set_broadcast(true))?,
        (UdpMode::Multicast, IpAddr::V4(_), bind_ip) => {
            opt(
                "IP_MULTICAST_TTL",
                socket.set_multicast_ttl_v4(cfg.multicast_ttl),
            )?;
            opt(
                "IP_MULTICAST_LOOP",
                socket.set_multicast_loop_v4(cfg.multicast_loop),
            )?;
            if let IpAddr::V4(iface) = bind_ip {
                if !iface.is_unspecified() {
                    opt("IP_MULTICAST_IF", socket.set_multicast_if_v4(&iface))?;
                }
            }
        }
        (UdpMode::Multicast, IpAddr::V6(_), _) => {
            opt(
                "IPV6_MULTICAST_HOPS",
                socket.set_multicast_hops_v6(cfg.multicast_ttl),
            )?;
            opt(
                "IPV6_MULTICAST_LOOP",
                socket.set_multicast_loop_v6(cfg.multicast_loop),
            )?;
        }
        _ => {}
    }
    socket
        .bind(&bind.into())
        .map_err(|e| format!("bind {bind}: {e}"))?;
    let socket = Arc::new(into_tokio(socket).map_err(|e| e.to_string())?);
    let local = socket.local_addr().ok();

    ctx.set_state(
        EndpointState::Ready,
        local,
        Some(target.to_string()),
        Some(format!("{:?} → {target}", cfg.mode).to_lowercase()),
    );
    ctx.info(format!(
        "UDP output bound to {} sending {:?} to {target}",
        local.map(|l| l.to_string()).unwrap_or_else(|| "?".into()),
        cfg.mode
    ));

    // Many devices reply to the sender's port; show those replies too.
    tasks.push(tokio::spawn(reply_loop(
        socket.clone(),
        local,
        target,
        ctx.clone(),
    )));

    Ok(UdpOutput {
        socket,
        target,
        local,
    })
}

async fn reply_loop(
    socket: Arc<UdpSocket>,
    local: Option<SocketAddr>,
    target: SocketAddr,
    ctx: Ctx,
) {
    let mut buf = vec![0u8; RECV_BUF];
    loop {
        match socket.recv_from(&mut buf).await {
            Ok((n, from)) => ctx.packet_in(&buf[..n], Some(n), local, from),
            // Windows surfaces ICMP "port unreachable" from an earlier send as a recv error.
            Err(e) if e.kind() == ErrorKind::ConnectionReset => ctx.error(format!(
                "ICMP port unreachable from {target}: nothing is listening there ({e})"
            )),
            Err(e) => {
                ctx.error(format!("receive on output socket failed: {e}"));
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
        }
    }
}

pub(crate) async fn start_input(
    cfg: &InputConfig,
    ctx: &Ctx,
    tasks: &mut TaskGroup,
) -> Result<(), String> {
    let bind_ip = parse_ip("bind address", &cfg.bind_address)?;
    let group = cfg
        .multicast_group
        .as_deref()
        .map(str::trim)
        .filter(|g| !g.is_empty())
        .map(|g| parse_ip("multicast group", g))
        .transpose()?;
    if let Some(g) = group {
        if !g.is_multicast() {
            return Err(format!("{g} is not a multicast address"));
        }
    }
    let bind = SocketAddr::new(bind_ip, cfg.port);

    let socket = socket_for(&bind).map_err(|e| format!("socket(): {e}"))?;
    if group.is_some() {
        // Lets several listeners on this host share a multicast port.
        socket
            .set_reuse_address(true)
            .map_err(|e| format!("SO_REUSEADDR: {e}"))?;
    }
    socket
        .bind(&bind.into())
        .map_err(|e| format!("bind {bind}: {e}"))?;
    let mut detail = "listening".to_string();
    match (group, bind_ip) {
        (Some(IpAddr::V4(g)), iface) => {
            let iface = match iface {
                IpAddr::V4(i) => i,
                IpAddr::V6(_) => Ipv4Addr::UNSPECIFIED,
            };
            socket
                .join_multicast_v4(&g, &iface)
                .map_err(|e| format!("join multicast {g} on {iface}: {e}"))?;
            detail = format!("joined {g} on {iface}");
        }
        (Some(IpAddr::V6(g)), _) => {
            socket
                .join_multicast_v6(&g, 0)
                .map_err(|e| format!("join multicast {g}: {e}"))?;
            detail = format!("joined {g}");
        }
        (None, _) => {}
    }
    let socket = into_tokio(socket).map_err(|e| e.to_string())?;
    let local = socket.local_addr().ok();
    ctx.set_state(EndpointState::Ready, local, None, Some(detail.clone()));
    ctx.info(format!(
        "UDP input bound to {} ({detail})",
        local
            .map(|l| l.to_string())
            .unwrap_or_else(|| bind.to_string())
    ));

    let ctx = ctx.clone();
    tasks.push(tokio::spawn(async move {
        let mut buf = vec![0u8; RECV_BUF];
        loop {
            match socket.recv_from(&mut buf).await {
                Ok((n, from)) => ctx.packet_in(&buf[..n], Some(n), local, from),
                Err(e) if e.kind() == ErrorKind::ConnectionReset => ctx.error(format!(
                    "ICMP port unreachable reported on input socket ({e})"
                )),
                Err(e) => {
                    ctx.error(format!("receive failed: {e}"));
                    tokio::time::sleep(Duration::from_millis(250)).await;
                }
            }
        }
    }));
    Ok(())
}
