use std::net::{IpAddr, SocketAddr};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::net::tcp::OwnedWriteHalf;
use tokio::net::{TcpListener, TcpSocket, TcpStream};
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinSet;

use super::ctx::Ctx;
use super::framing::{encode_frame, FrameDecoder};
use super::status::EndpointState;
use super::util::{bind_for, parse_ip, Resolver, TaskGroup};
use super::{InputConfig, OutputConfig, TcpFraming};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
/// A write that cannot complete in this time means the peer stopped reading. The connection
/// is dropped (and reconnected) instead of letting the send, and the widget behind it, hang.
pub const WRITE_TIMEOUT: Duration = Duration::from_secs(2);
/// Concurrent clients per TCP input. More are refused, so a misbehaving peer can't exhaust
/// memory (each client holds a read buffer and a frame decoder).
pub const MAX_TCP_CLIENTS: usize = 64;

struct Connection {
    writer: OwnedWriteHalf,
    local: Option<SocketAddr>,
    remote: SocketAddr,
}

pub(crate) struct TcpOutput {
    conn: Mutex<Option<Connection>>,
    /// Wakes the connection task when a write fails so it reconnects immediately.
    broken: mpsc::UnboundedSender<()>,
    framing: TcpFraming,
    target_label: String,
}

impl TcpOutput {
    /// The connected peer's address, if connected.
    pub async fn target(&self) -> Option<SocketAddr> {
        self.conn.lock().await.as_ref().map(|c| c.remote)
    }

    pub async fn send(&self, ctx: &Ctx, bytes: &[u8], source: Option<&str>) {
        let frame = encode_frame(self.framing, bytes);
        let mut guard = self.conn.lock().await;
        let Some(conn) = guard.as_mut() else {
            // Never queue while disconnected: a fader value delivered seconds late is worse
            // than one that visibly failed.
            ctx.packet_out(
                bytes,
                frame.len(),
                None,
                self.target_label.clone(),
                Err("not connected; packet dropped".into()),
                source,
            );
            return;
        };
        let result = match tokio::time::timeout(WRITE_TIMEOUT, conn.writer.write_all(&frame)).await
        {
            Ok(written) => written.map_err(|e| e.to_string()),
            Err(_) => Err(format!(
                "write timed out after {}s: the peer is not reading; connection dropped",
                WRITE_TIMEOUT.as_secs()
            )),
        };
        let (local, remote) = (conn.local, conn.remote.to_string());
        if result.is_err() {
            *guard = None;
            let _ = self.broken.send(());
        }
        drop(guard);
        ctx.packet_out(bytes, frame.len(), local, remote, result, source);
    }
}

pub(crate) fn start_output(
    cfg: &OutputConfig,
    ctx: &Ctx,
    tasks: &mut TaskGroup,
    resolver: Resolver,
) -> Result<Arc<TcpOutput>, String> {
    let bind_ip = parse_ip("bind address", &cfg.bind_address)?;
    let (broken, broken_rx) = mpsc::unbounded_channel();
    let out = Arc::new(TcpOutput {
        conn: Mutex::new(None),
        broken,
        framing: cfg.framing,
        target_label: format!("{}:{}", cfg.host, cfg.port),
    });
    tasks.push(tokio::spawn(connection_loop(
        cfg.clone(),
        bind_ip,
        ctx.clone(),
        out.clone(),
        broken_rx,
        resolver,
    )));
    Ok(out)
}

/// Keeps the output connected: connect, serve the connection until it ends, wait
/// `reconnect_ms`, repeat. Each distinct connect failure is reported once, not once per retry.
async fn connection_loop(
    cfg: OutputConfig,
    bind_ip: IpAddr,
    ctx: Ctx,
    out: Arc<TcpOutput>,
    mut broken_rx: mpsc::UnboundedReceiver<()>,
    resolver: Resolver,
) {
    let mut last_error: Option<String> = None;
    loop {
        let target = Some(out.target_label.clone());
        ctx.set_state(EndpointState::Connecting, None, target.clone(), None);
        match connect(&cfg, bind_ip, &resolver).await {
            Ok(stream) => {
                last_error = None;
                run_connection(stream, cfg.framing, &ctx, &out, &mut broken_rx).await;
            }
            Err(e) => {
                ctx.set_state(EndpointState::Error, None, target, Some(e.clone()));
                if last_error.as_ref() != Some(&e) {
                    ctx.error(format!("{e} (retrying every {} ms)", cfg.reconnect_ms));
                    last_error = Some(e);
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(cfg.reconnect_ms.max(100) as u64)).await;
    }
}

/// Serves one established connection until the peer closes it or a write fails.
async fn run_connection(
    stream: TcpStream,
    framing: TcpFraming,
    ctx: &Ctx,
    out: &TcpOutput,
    broken_rx: &mut mpsc::UnboundedReceiver<()>,
) {
    let local = stream.local_addr().ok();
    let remote = stream
        .peer_addr()
        .unwrap_or_else(|_| SocketAddr::from(([0, 0, 0, 0], 0)));
    // While connected, packets from this socket (e.g. into this app's own TCP input) are ours.
    let _own = local.map(|l| ctx.input.register_own(l));
    let (reader, writer) = stream.into_split();
    *out.conn.lock().await = Some(Connection {
        writer,
        local,
        remote,
    });
    // Discard write-failure signals that belonged to a previous connection.
    while broken_rx.try_recv().is_ok() {}
    ctx.set_state(
        EndpointState::Ready,
        local,
        Some(remote.to_string()),
        Some("connected".into()),
    );
    ctx.info(format!("TCP connected to {remote} ({framing:?} framing)"));
    let ended = tokio::select! {
        reason = read_stream(reader, framing, ctx, local, remote) => format!("closed: {reason}"),
        _ = broken_rx.recv() => "dropped after a write error".to_string(),
    };
    ctx.info(format!("TCP connection to {remote} {ended}"));
    *out.conn.lock().await = None;
}

async fn connect(
    cfg: &OutputConfig,
    bind_ip: IpAddr,
    resolver: &Resolver,
) -> Result<TcpStream, String> {
    let target = resolver(cfg.host.clone(), cfg.port).await?;
    let bind = bind_for(bind_ip, &target, cfg.local_port);
    let socket = if target.is_ipv4() {
        TcpSocket::new_v4()
    } else {
        TcpSocket::new_v6()
    }
    .map_err(|e| format!("socket(): {e}"))?;
    if !bind.ip().is_unspecified() || bind.port() != 0 {
        socket.bind(bind).map_err(|e| format!("bind {bind}: {e}"))?;
    }
    let stream = tokio::time::timeout(CONNECT_TIMEOUT, socket.connect(target))
        .await
        .map_err(|_| {
            format!(
                "connect to {target} timed out after {}s",
                CONNECT_TIMEOUT.as_secs()
            )
        })?
        .map_err(|e| format!("connect to {target}: {e}"))?;
    // OSC control data is latency-sensitive; never wait to coalesce small writes.
    let _ = stream.set_nodelay(true);
    Ok(stream)
}

/// Reads and de-frames packets until the stream ends; returns why it ended.
async fn read_stream(
    mut reader: impl AsyncRead + Unpin,
    framing: TcpFraming,
    ctx: &Ctx,
    local: Option<SocketAddr>,
    remote: SocketAddr,
) -> String {
    let mut decoder = FrameDecoder::new(framing);
    let mut buf = vec![0u8; 16 * 1024];
    loop {
        match reader.read(&mut buf).await {
            Ok(0) => return "closed by peer".into(),
            Ok(n) => {
                for frame in decoder.feed(&buf[..n]) {
                    match frame {
                        Ok(packet) => ctx.packet_in(&packet, None, local, remote),
                        Err(e) => ctx.error(format!("from {remote}: {e}")),
                    }
                }
            }
            Err(e) => return e.to_string(),
        }
    }
}

fn listen(bind: SocketAddr) -> std::io::Result<TcpListener> {
    let listener = std::net::TcpListener::bind(bind)?;
    listener.set_nonblocking(true)?;
    TcpListener::from_std(listener)
}

pub(crate) fn start_input(
    cfg: &InputConfig,
    ctx: &Ctx,
    tasks: &mut TaskGroup,
) -> Result<(), String> {
    let bind = SocketAddr::new(parse_ip("bind address", &cfg.bind_address)?, cfg.port);
    let listener = listen(bind).map_err(|e| format!("listen on {bind}: {e}"))?;
    let local = listener.local_addr().ok();
    let clients = Arc::new(AtomicUsize::new(0));
    let detail = |n: usize| Some(format!("listening, {n} client(s)"));
    ctx.set_state(EndpointState::Ready, local, None, detail(0));
    ctx.info(format!(
        "TCP input listening on {} ({:?} framing)",
        local.unwrap_or(bind),
        cfg.framing
    ));

    let (framing, ctx) = (cfg.framing, ctx.clone());
    tasks.push(tokio::spawn(async move {
        // Dropping the JoinSet (when this task is aborted) aborts every client task too.
        let mut sessions = JoinSet::new();
        loop {
            match listener.accept().await {
                Ok((stream, peer)) => {
                    while sessions.try_join_next().is_some() {}
                    if clients.load(Ordering::SeqCst) >= MAX_TCP_CLIENTS {
                        ctx.error(format!(
                            "refused TCP client {peer}: already {MAX_TCP_CLIENTS} clients"
                        ));
                        continue;
                    }
                    let _ = stream.set_nodelay(true);
                    let n = clients.fetch_add(1, Ordering::SeqCst) + 1;
                    ctx.set_detail(detail(n));
                    ctx.info(format!("TCP client connected from {peer}"));
                    let (ctx, clients) = (ctx.clone(), clients.clone());
                    sessions.spawn(async move {
                        let local = stream.local_addr().ok();
                        let reason = read_stream(stream, framing, &ctx, local, peer).await;
                        let n = clients.fetch_sub(1, Ordering::SeqCst) - 1;
                        ctx.set_detail(detail(n));
                        ctx.info(format!("TCP client {peer} disconnected: {reason}"));
                    });
                }
                Err(e) => {
                    ctx.error(format!("accept failed: {e}"));
                    tokio::time::sleep(Duration::from_millis(250)).await;
                }
            }
        }
    }));
    Ok(())
}
