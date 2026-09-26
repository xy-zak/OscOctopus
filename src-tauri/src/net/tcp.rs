use std::net::SocketAddr;
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
use super::util::{bind_for, parse_ip, resolve, TaskGroup};
use super::{InputConfig, OutputConfig, TcpFraming};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);

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
        let result = conn
            .writer
            .write_all(&frame)
            .await
            .map_err(|e| e.to_string());
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
) -> Result<Arc<TcpOutput>, String> {
    let bind_ip = parse_ip("bind address", &cfg.bind_address)?;
    let (broken, mut broken_rx) = mpsc::unbounded_channel();
    let out = Arc::new(TcpOutput {
        conn: Mutex::new(None),
        broken,
        framing: cfg.framing,
        target_label: format!("{}:{}", cfg.host, cfg.port),
    });
    let (cfg, ctx, task_out) = (cfg.clone(), ctx.clone(), out.clone());
    tasks.push(tokio::spawn(async move {
        let mut last_error: Option<String> = None;
        loop {
            ctx.set_state(EndpointState::Connecting, None, Some(task_out.target_label.clone()), None);
            match connect(&cfg, bind_ip).await {
                Ok(stream) => {
                    last_error = None;
                    let local = stream.local_addr().ok();
                    let remote = stream.peer_addr().unwrap_or_else(|_| SocketAddr::from(([0, 0, 0, 0], 0)));
                    let (reader, writer) = stream.into_split();
                    *task_out.conn.lock().await = Some(Connection { writer, local, remote });
                    // Discard write-failure signals that belonged to a previous connection.
                    while broken_rx.try_recv().is_ok() {}
                    ctx.set_state(EndpointState::Ready, local, Some(remote.to_string()), Some("connected".into()));
                    ctx.info(format!("TCP connected to {remote} ({:?} framing)", cfg.framing));
                    tokio::select! {
                        reason = read_stream(reader, cfg.framing, &ctx, local, remote) => ctx.info(format!("TCP connection to {remote} closed: {reason}")),
                        _ = broken_rx.recv() => ctx.info(format!("TCP connection to {remote} dropped after a write error")),
                    }
                    *task_out.conn.lock().await = None;
                }
                Err(e) => {
                    ctx.set_state(EndpointState::Error, None, Some(task_out.target_label.clone()), Some(e.clone()));
                    // Report each distinct failure once instead of once per retry.
                    if last_error.as_ref() != Some(&e) {
                        ctx.error(format!("{e} (retrying every {} ms)", cfg.reconnect_ms));
                        last_error = Some(e);
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(cfg.reconnect_ms.max(100) as u64)).await;
        }
    }));
    Ok(out)
}

async fn connect(cfg: &OutputConfig, bind_ip: std::net::IpAddr) -> Result<TcpStream, String> {
    let target = resolve(&cfg.host, cfg.port).await?;
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

pub(crate) async fn start_input(
    cfg: &InputConfig,
    ctx: &Ctx,
    tasks: &mut TaskGroup,
) -> Result<(), String> {
    let bind = SocketAddr::new(parse_ip("bind address", &cfg.bind_address)?, cfg.port);
    let listener = TcpListener::bind(bind)
        .await
        .map_err(|e| format!("listen on {bind}: {e}"))?;
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
