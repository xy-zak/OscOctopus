use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tokio::sync::{Mutex, RwLock};
use tokio::task::JoinSet;

use super::ctx::Ctx;
use super::status::{
    key, EndpointKey, EndpointKind, EndpointState, EndpointStats, EndpointStatus, StatusBoard,
    StatusListener,
};
use super::util::{system_resolver, Resolver, TaskGroup};
use super::{tcp, udp, InputConfig, NetworkConfig, OutputConfig, Transport};
use crate::debug::{DebugEvent, DebugHub, DebugKind};
use crate::error::{AppError, AppResult};
use crate::osc::{encode_message, OscMessage};

enum Sender {
    Udp(udp::UdpOutput),
    Tcp(Arc<tcp::TcpOutput>),
}

struct RunningOutput {
    ctx: Ctx,
    sender: Sender,
    _tasks: TaskGroup,
}

/// Everything is keyed by (desk, endpoint id): each open desk (preset) has its own network
/// config, and all desks run at the same time.
#[derive(Default)]
struct Endpoints {
    output_cfgs: HashMap<EndpointKey, OutputConfig>,
    input_cfgs: HashMap<EndpointKey, InputConfig>,
    outputs: HashMap<EndpointKey, Arc<RunningOutput>>,
    /// Inputs have no handle besides their tasks; dropping the group closes the socket.
    inputs: HashMap<EndpointKey, TaskGroup>,
}

impl Endpoints {
    /// An endpoint is kept only if its config is identical and it is either disabled or
    /// actually running; failed endpoints are retried on every apply.
    fn keeps_output(&self, desk: &str, cfg: &OutputConfig) -> bool {
        let k = key(desk, &cfg.id);
        self.output_cfgs.get(&k) == Some(cfg) && (!cfg.enabled || self.outputs.contains_key(&k))
    }

    fn keeps_input(&self, desk: &str, cfg: &InputConfig) -> bool {
        let k = key(desk, &cfg.id);
        self.input_cfgs.get(&k) == Some(cfg) && (!cfg.enabled || self.inputs.contains_key(&k))
    }
}

/// Owns every socket. For each desk the frontend describes the desired `NetworkConfig`;
/// `apply` reconciles that desk's running endpoints against it, restarting only what changed.
pub struct NetworkManager {
    debug: Arc<DebugHub>,
    board: Arc<StatusBoard>,
    resolver: Resolver,
    endpoints: RwLock<Endpoints>,
    /// Serialises `apply` calls. The endpoint map itself is write-locked only for the final,
    /// synchronous commit, so sends keep flowing while an apply waits on DNS.
    apply_lock: Mutex<()>,
    /// Global output gate: when set, nothing is written to any output socket.
    paused: AtomicBool,
}

impl NetworkManager {
    pub fn new(debug: Arc<DebugHub>, on_status: StatusListener) -> Self {
        Self {
            debug,
            board: Arc::new(StatusBoard::new(on_status)),
            resolver: system_resolver(),
            endpoints: RwLock::new(Endpoints::default()),
            apply_lock: Mutex::new(()),
            paused: AtomicBool::new(false),
        }
    }

    /// Replaces the hostname resolver (tests use this to simulate slow or failing DNS).
    pub fn with_resolver(mut self, resolver: Resolver) -> Self {
        self.resolver = resolver;
        self
    }

    pub fn status(&self) -> Vec<EndpointStatus> {
        self.board.snapshot()
    }

    pub fn status_of(&self, desk: &str, id: &str) -> Option<EndpointStatus> {
        self.board.get(&key(desk, id))
    }

    pub fn is_paused(&self) -> bool {
        self.paused.load(Ordering::SeqCst)
    }

    /// Pauses or resumes all output. Returns the new state. Inputs keep receiving.
    pub fn set_paused(&self, paused: bool) -> bool {
        let was = self.paused.swap(paused, Ordering::SeqCst);
        if was != paused {
            self.debug.push(DebugEvent {
                kind: DebugKind::Info,
                endpoint_name: "network".into(),
                message: Some(
                    if paused {
                        "OUTPUT PAUSED: no OSC leaves the app until resumed"
                    } else {
                        "output resumed"
                    }
                    .into(),
                ),
                ..Default::default()
            });
        }
        paused
    }

    fn ctx(
        &self,
        desk: &str,
        id: &str,
        name: &str,
        kind: EndpointKind,
        transport: Transport,
    ) -> Ctx {
        Ctx {
            desk: desk.to_string(),
            id: id.to_string(),
            name: name.to_string(),
            kind,
            transport,
            board: self.board.clone(),
            debug: self.debug.clone(),
        }
    }

    fn register(&self, ctx: &Ctx, enabled: bool) {
        self.board.insert(EndpointStatus {
            desk: ctx.desk.clone(),
            id: ctx.id.clone(),
            name: ctx.name.clone(),
            kind: ctx.kind,
            transport: ctx.transport,
            state: if enabled {
                EndpointState::Starting
            } else {
                EndpointState::Disabled
            },
            local: None,
            remote: None,
            detail: None,
            stats: EndpointStats::default(),
        });
    }

    /// Reconciles one desk's endpoints; other desks are untouched. Returns every status.
    ///
    /// Three phases, all under `apply_lock` so no other apply can interleave:
    /// 1. plan (read lock): which endpoints stay exactly as they are;
    /// 2. resolve (no endpoint lock): hostnames of UDP outputs about to start, concurrently
    ///    and with a timeout, so a slow lookup never blocks sends on any desk;
    /// 3. commit (write lock): stop what was removed or changed, start what is new. Nothing
    ///    in this phase waits on the network.
    pub async fn apply(&self, desk: &str, config: NetworkConfig) -> AppResult<Vec<EndpointStatus>> {
        validate(desk, &config)?;
        let _serialised = self.apply_lock.lock().await;

        let (keep_out, keep_in): (HashSet<String>, HashSet<String>) = {
            let eps = self.endpoints.read().await;
            (
                config
                    .outputs
                    .iter()
                    .filter(|c| eps.keeps_output(desk, c))
                    .map(|c| c.id.clone())
                    .collect(),
                config
                    .inputs
                    .iter()
                    .filter(|c| eps.keeps_input(desk, c))
                    .map(|c| c.id.clone())
                    .collect(),
            )
        };
        let start_outputs: Vec<&OutputConfig> = config
            .outputs
            .iter()
            .filter(|c| !keep_out.contains(&c.id))
            .collect();
        let start_inputs: Vec<&InputConfig> = config
            .inputs
            .iter()
            .filter(|c| !keep_in.contains(&c.id))
            .collect();

        let mut targets = self.resolve_udp_targets(&start_outputs).await;

        let mut eps = self.endpoints.write().await;
        // Stop everything of this desk that was removed or changed first, so its ports are
        // free for the new config.
        let stop_out: Vec<EndpointKey> = eps
            .output_cfgs
            .keys()
            .filter(|(d, id)| d == desk && !keep_out.contains(id))
            .cloned()
            .collect();
        let stop_in: Vec<EndpointKey> = eps
            .input_cfgs
            .keys()
            .filter(|(d, id)| d == desk && !keep_in.contains(id))
            .cloned()
            .collect();
        for k in stop_out {
            let cfg = eps.output_cfgs.remove(&k);
            if eps.outputs.remove(&k).is_some() {
                self.lifecycle(&k, cfg.map(|c| c.name), "output stopped");
            }
            self.board.remove(&k);
        }
        for k in stop_in {
            let cfg = eps.input_cfgs.remove(&k);
            if eps.inputs.remove(&k).is_some() {
                self.lifecycle(&k, cfg.map(|c| c.name), "input stopped");
            }
            self.board.remove(&k);
        }

        for cfg in start_outputs {
            let k = key(desk, &cfg.id);
            eps.output_cfgs.insert(k.clone(), cfg.clone());
            let ctx = self.ctx(
                desk,
                &cfg.id,
                &cfg.name,
                EndpointKind::Output,
                cfg.transport,
            );
            self.register(&ctx, cfg.enabled);
            if !cfg.enabled {
                continue;
            }
            let mut tasks = TaskGroup::default();
            let started = match cfg.transport {
                Transport::Udp => targets
                    .remove(&cfg.id)
                    .unwrap_or_else(|| Err("hostname lookup did not complete".into()))
                    .and_then(|target| udp::start_output(cfg, target, &ctx, &mut tasks))
                    .map(Sender::Udp),
                Transport::Tcp => {
                    tcp::start_output(cfg, &ctx, &mut tasks, self.resolver.clone()).map(Sender::Tcp)
                }
            };
            match started {
                Ok(sender) => {
                    let running = RunningOutput {
                        ctx,
                        sender,
                        _tasks: tasks,
                    };
                    eps.outputs.insert(k, Arc::new(running));
                }
                Err(e) => fail(&ctx, e),
            }
        }
        for cfg in start_inputs {
            let k = key(desk, &cfg.id);
            eps.input_cfgs.insert(k.clone(), cfg.clone());
            let ctx = self.ctx(desk, &cfg.id, &cfg.name, EndpointKind::Input, cfg.transport);
            self.register(&ctx, cfg.enabled);
            if !cfg.enabled {
                continue;
            }
            let mut tasks = TaskGroup::default();
            let started = match cfg.transport {
                Transport::Udp => udp::start_input(cfg, &ctx, &mut tasks),
                Transport::Tcp => tcp::start_input(cfg, &ctx, &mut tasks),
            };
            match started {
                Ok(()) => {
                    eps.inputs.insert(k, tasks);
                }
                Err(e) => fail(&ctx, e),
            }
        }
        drop(eps);
        Ok(self.board.snapshot())
    }

    /// Resolves the targets of the enabled UDP outputs that are about to start, concurrently.
    /// (TCP outputs resolve inside their own reconnect loop.)
    async fn resolve_udp_targets(
        &self,
        outputs: &[&OutputConfig],
    ) -> HashMap<String, Result<SocketAddr, String>> {
        let mut lookups = JoinSet::new();
        for cfg in outputs
            .iter()
            .filter(|c| c.enabled && c.transport == Transport::Udp)
        {
            let (id, lookup) = (cfg.id.clone(), (self.resolver)(cfg.host.clone(), cfg.port));
            lookups.spawn(async move { (id, lookup.await) });
        }
        let mut targets = HashMap::new();
        while let Some(done) = lookups.join_next().await {
            if let Ok((id, target)) = done {
                targets.insert(id, target);
            }
        }
        targets
    }

    /// Stops every endpoint of a desk (the desk was closed).
    pub async fn close_desk(&self, desk: &str) -> AppResult<Vec<EndpointStatus>> {
        self.apply(desk, NetworkConfig::default()).await
    }

    /// Encodes once and sends to each of the desk's outputs. Per-output results go to the
    /// debug log; only an encode failure (the message itself is invalid) is returned as an
    /// error. While paused, nothing is written: each output records a "blocked" event instead.
    pub async fn send(
        &self,
        desk: &str,
        output_ids: &[String],
        msg: &OscMessage,
        source: Option<&str>,
    ) -> AppResult<()> {
        let bytes = match encode_message(msg) {
            Ok(b) => b,
            Err(e) => {
                self.debug.push(DebugEvent {
                    kind: DebugKind::Error,
                    desk: Some(desk.to_string()),
                    endpoint_name: "encoder".into(),
                    error: Some(e.to_string()),
                    source: source.map(str::to_string),
                    ..Default::default()
                });
                return Err(e);
            }
        };
        let targets: Vec<(EndpointKey, Option<Arc<RunningOutput>>)> = {
            let eps = self.endpoints.read().await;
            output_ids
                .iter()
                .map(|id| {
                    let k = key(desk, id);
                    let out = eps.outputs.get(&k).cloned();
                    (k, out)
                })
                .collect()
        };
        // Checked once per message so a message is never half-sent across outputs.
        let paused = self.is_paused();
        for (k, output) in targets {
            match output {
                Some(out) if paused => out.ctx.packet_blocked(&bytes, source),
                Some(out) => match &out.sender {
                    Sender::Udp(u) => u.send(&out.ctx, &bytes, source).await,
                    Sender::Tcp(t) => t.send(&out.ctx, &bytes, source).await,
                },
                None => self.not_running(&k, &bytes, source),
            }
        }
        Ok(())
    }

    /// Records a packet addressed to an output that isn't running, and why.
    fn not_running(&self, k: &EndpointKey, bytes: &[u8], source: Option<&str>) {
        let status = self.board.get(k);
        let reason = match &status {
            Some(s) if s.state == EndpointState::Disabled => {
                "output is disabled; packet not sent".into()
            }
            Some(s) => format!(
                "output is not running ({}); packet not sent",
                s.detail.clone().unwrap_or_else(|| format!("{:?}", s.state))
            ),
            None => "no output with this id on this desk; packet not sent".into(),
        };
        self.debug.push(DebugEvent {
            kind: DebugKind::Error,
            desk: Some(k.0.clone()),
            endpoint_id: k.1.clone(),
            endpoint_name: status.map(|s| s.name).unwrap_or_default(),
            bytes: bytes.to_vec(),
            error: Some(reason),
            source: source.map(str::to_string),
            ..Default::default()
        });
    }

    fn lifecycle(&self, k: &EndpointKey, name: Option<String>, message: &str) {
        self.debug.push(DebugEvent {
            kind: DebugKind::Info,
            desk: Some(k.0.clone()),
            endpoint_id: k.1.clone(),
            endpoint_name: name.unwrap_or_default(),
            message: Some(message.into()),
            ..Default::default()
        });
    }
}

fn fail(ctx: &Ctx, error: String) {
    ctx.set_state(EndpointState::Error, None, None, Some(error.clone()));
    ctx.error(error);
}

fn validate(desk: &str, config: &NetworkConfig) -> AppResult<()> {
    if desk.trim().is_empty() {
        return Err(AppError::Config("desk id must not be empty".into()));
    }
    let mut seen = HashSet::new();
    let ids = config
        .outputs
        .iter()
        .map(|o| o.id.as_str())
        .chain(config.inputs.iter().map(|i| i.id.as_str()));
    for id in ids {
        if id.trim().is_empty() {
            return Err(AppError::Config(
                "every endpoint needs a non-empty id".into(),
            ));
        }
        if !seen.insert(id) {
            return Err(AppError::Config(format!("duplicate endpoint id '{id}'")));
        }
    }
    Ok(())
}
