use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tokio::sync::{Mutex, RwLock};

use super::ctx::{Ctx, IncomingListener};
use super::status::{
    key, EndpointKey, EndpointKind, EndpointState, EndpointStats, EndpointStatus, StatusBoard,
    StatusListener,
};
use super::util::TaskGroup;
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

/// Owns every socket. For each desk the frontend describes the desired `NetworkConfig`;
/// `apply` reconciles that desk's running endpoints against it, restarting only what changed.
pub struct NetworkManager {
    debug: Arc<DebugHub>,
    board: Arc<StatusBoard>,
    incoming: IncomingListener,
    endpoints: RwLock<Endpoints>,
    apply_lock: Mutex<()>,
    /// Global output gate: when set, nothing is written to any output socket.
    paused: AtomicBool,
}

impl NetworkManager {
    pub fn new(
        debug: Arc<DebugHub>,
        on_status: StatusListener,
        incoming: IncomingListener,
    ) -> Self {
        Self {
            debug,
            board: Arc::new(StatusBoard::new(on_status)),
            incoming,
            endpoints: RwLock::new(Endpoints::default()),
            apply_lock: Mutex::new(()),
            paused: AtomicBool::new(false),
        }
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
            incoming: self.incoming.clone(),
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
    pub async fn apply(&self, desk: &str, config: NetworkConfig) -> AppResult<Vec<EndpointStatus>> {
        validate(desk, &config)?;
        let _serialised = self.apply_lock.lock().await;
        let mut eps = self.endpoints.write().await;

        // A config is kept only if it is identical and either disabled or actually running;
        // failed endpoints are retried on every apply.
        let keep_output = |eps: &Endpoints, cfg: &OutputConfig| {
            let k = key(desk, &cfg.id);
            eps.output_cfgs.get(&k) == Some(cfg) && (!cfg.enabled || eps.outputs.contains_key(&k))
        };
        let keep_input = |eps: &Endpoints, cfg: &InputConfig| {
            let k = key(desk, &cfg.id);
            eps.input_cfgs.get(&k) == Some(cfg) && (!cfg.enabled || eps.inputs.contains_key(&k))
        };
        let wanted_outputs: Vec<&OutputConfig> = config
            .outputs
            .iter()
            .filter(|c| !keep_output(&eps, c))
            .collect();
        let wanted_inputs: Vec<&InputConfig> = config
            .inputs
            .iter()
            .filter(|c| !keep_input(&eps, c))
            .collect();

        // 1. Stop everything of this desk that was removed or changed first, so its ports are
        //    free for the new config.
        let keep_out: HashSet<&str> = config
            .outputs
            .iter()
            .filter(|c| keep_output(&eps, c))
            .map(|c| c.id.as_str())
            .collect();
        let keep_in: HashSet<&str> = config
            .inputs
            .iter()
            .filter(|c| keep_input(&eps, c))
            .map(|c| c.id.as_str())
            .collect();
        let stop_out: Vec<EndpointKey> = eps
            .output_cfgs
            .keys()
            .filter(|(d, id)| d == desk && !keep_out.contains(id.as_str()))
            .cloned()
            .collect();
        let stop_in: Vec<EndpointKey> = eps
            .input_cfgs
            .keys()
            .filter(|(d, id)| d == desk && !keep_in.contains(id.as_str()))
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

        // 2. Start new or changed endpoints.
        for cfg in wanted_outputs {
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
                Transport::Udp => udp::start_output(cfg, &ctx, &mut tasks)
                    .await
                    .map(Sender::Udp),
                Transport::Tcp => tcp::start_output(cfg, &ctx, &mut tasks).map(Sender::Tcp),
            };
            match started {
                Ok(sender) => {
                    eps.outputs.insert(
                        k,
                        Arc::new(RunningOutput {
                            ctx,
                            sender,
                            _tasks: tasks,
                        }),
                    );
                }
                Err(e) => fail(&ctx, e),
            }
        }
        for cfg in wanted_inputs {
            let k = key(desk, &cfg.id);
            eps.input_cfgs.insert(k.clone(), cfg.clone());
            let ctx = self.ctx(desk, &cfg.id, &cfg.name, EndpointKind::Input, cfg.transport);
            self.register(&ctx, cfg.enabled);
            if !cfg.enabled {
                continue;
            }
            let mut tasks = TaskGroup::default();
            let started = match cfg.transport {
                Transport::Udp => udp::start_input(cfg, &ctx, &mut tasks).await,
                Transport::Tcp => tcp::start_input(cfg, &ctx, &mut tasks).await,
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
                None => {
                    let status = self.board.get(&k);
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
                        bytes: bytes.clone(),
                        error: Some(reason),
                        source: source.map(str::to_string),
                        ..Default::default()
                    });
                }
            }
        }
        Ok(())
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
