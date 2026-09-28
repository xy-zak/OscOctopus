//! Sequencer runs: a widget's list of OSC messages played in a loop, each followed by its wait.
//! The timing lives here rather than in the webview, whose timers are throttled while the
//! window is hidden or minimised; a run keeps exact time whatever the UI is doing.
//!
//! - **Drift-free.** Each send is scheduled from the previous deadline, not from when the last
//!   send finished. A run that falls behind (a slow output, a suspended machine) resyncs to
//!   now and says so in TRAFFIC; it never bursts to catch up.
//! - **Cooperative.** Control changes (pause, a new plan, stop) are only acted on between
//!   sends. A send in progress always finishes: aborting it could leave half a TCP frame on a
//!   live connection.
//! - **Through the network manager.** Every step goes through `NetworkManager::send` with the
//!   widget as its source, so OSC-OUT off holds it back and TRAFFIC shows it like any send.
//! - **Never spinning.** A pass lasts the sum of its waits, but at least [`pass_floor`].
//!
//! The frontend owns the widget and builds the plan (`src/lib/widgets/sequencer/plan.ts`);
//! progress comes back in batches (~30 Hz), latest-wins per run.

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::sync::watch;
use tokio::time::{sleep_until, Instant};
use ts_rs::TS;

use crate::debug::{now_micros, DebugEvent, DebugHub, DebugKind};
use crate::error::{AppError, AppResult};
use crate::net::NetworkManager;
use crate::osc::{encode_message, OscMessage};
use crate::sync::wire::valid_id;

/// What a plan may hold. The frontend reads these from `bindings/defaults.json`.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Limits {
    pub max_steps: usize,
    pub max_delay_ms: u32,
    pub max_count: u32,
    /// The shortest pass, whatever its waits add up to...
    pub min_pass_ms: u64,
    /// ...and at least this much per step.
    pub min_pass_ms_per_step: u64,
}

pub const LIMITS: Limits = Limits {
    max_steps: 64,
    max_delay_ms: 3_600_000,
    max_count: 9_999,
    min_pass_ms: 10,
    min_pass_ms_per_step: 1,
};

/// A late run says so in TRAFFIC at most this often.
const LATE_NOTE_EVERY: Duration = Duration::from_secs(1);

/// The shortest a pass of `steps` steps may take, so a sequence of zero waits can't spin.
pub fn pass_floor(steps: usize) -> Duration {
    Duration::from_millis(
        LIMITS
            .min_pass_ms
            .max(LIMITS.min_pass_ms_per_step * steps as u64),
    )
}

/// One message of a sequence and the wait after it.
#[derive(Debug, Clone, PartialEq, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SeqStep {
    /// The step's id in the widget, so an edited plan continues after the step sent last.
    pub id: String,
    pub message: OscMessage,
    pub delay_ms: u32,
}

#[derive(Debug, Clone, PartialEq, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SeqPlan {
    /// Every step goes to these outputs of the run's desk.
    pub output_ids: Vec<String>,
    pub steps: Vec<SeqStep>,
    /// Passes to play; `None` plays forever.
    pub count: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum SeqState {
    Running,
    Paused,
    Stopped,
}

/// Why a run ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum SeqEnd {
    /// It played its passes.
    Done,
    Stopped,
    /// A new start of the same widget took its place.
    Replaced,
    DeskClosed,
}

/// Where a run is. Only the latest of each run reaches the UI.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SeqProgress {
    pub desk: String,
    pub widget: String,
    /// Increases with every start, so progress of an earlier run is recognised as stale.
    pub run: u64,
    pub state: SeqState,
    /// The step sent last (0-based); none yet.
    pub step: Option<u32>,
    /// The pass it is in, from 1.
    pub pass: u32,
    /// The wait after the step sent last, until the next (or the end), in ms.
    pub wait_ms: Option<u32>,
    /// What was left of that wait when this was reported (it stops going down while paused).
    pub left_ms: Option<u32>,
    /// When this was reported: wall-clock microseconds since the Unix epoch.
    pub at_micros: u64,
    pub ended: Option<SeqEnd>,
    /// How often it fell behind and resynced.
    pub late: u32,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SeqBatch {
    pub runs: Vec<SeqProgress>,
}

/// Where the steps go. The network manager in the app, a recorder in tests.
pub trait StepSink: Send + Sync + 'static {
    fn send_step<'a>(
        &'a self,
        desk: &'a str,
        output_ids: &'a [String],
        message: &'a OscMessage,
        source: &'a str,
    ) -> Pin<Box<dyn Future<Output = ()> + Send + 'a>>;
}

impl StepSink for NetworkManager {
    fn send_step<'a>(
        &'a self,
        desk: &'a str,
        output_ids: &'a [String],
        message: &'a OscMessage,
        source: &'a str,
    ) -> Pin<Box<dyn Future<Output = ()> + Send + 'a>> {
        // The only error is an encode failure, already logged; plans are encoded on start.
        Box::pin(async move {
            let _ = self
                .send(desk, output_ids, message, Some(source), None)
                .await;
        })
    }
}

/// (desk, widget)
type RunKey = (String, String);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Mode {
    Run,
    Pause,
    Stop(SeqEnd),
}

/// What the UI wants a run to do; the run follows it between sends.
#[derive(Debug, Clone)]
struct Desired {
    mode: Mode,
    plan: Arc<SeqPlan>,
}

struct Handle {
    run: u64,
    ctl: watch::Sender<Desired>,
}

#[derive(Default)]
struct Progress {
    /// Changed since the last drain.
    pending: HashMap<RunKey, SeqProgress>,
    /// The latest of every run still going, for a UI that (re)subscribes.
    current: HashMap<RunKey, SeqProgress>,
}

pub struct Sequencer {
    sink: Arc<dyn StepSink>,
    debug: Arc<DebugHub>,
    runs: Mutex<HashMap<RunKey, Handle>>,
    progress: Mutex<Progress>,
    next_run: AtomicU64,
}

/// The step sent last: an edited plan continues after it, and progress shows it.
struct Sent {
    index: usize,
    id: String,
    pass: u32,
}

/// A run's position between sends.
struct Cursor {
    /// The step sent next.
    index: usize,
    pass: u32,
    /// When it is sent.
    next: Instant,
    /// When the wait before it began: the deadline of the step sent last.
    since: Instant,
    /// When this pass began (the pass floor counts from here).
    pass_start: Instant,
    last: Option<Sent>,
    /// The last pass is played: the run ends at `next`.
    finishing: bool,
    late: u32,
    late_noted: Option<Instant>,
}

impl Cursor {
    /// Moves to the start of the next pass, or marks the run as finishing after its last one.
    fn wrap(&mut self, plan: &SeqPlan) {
        if plan.count.is_some_and(|c| self.pass >= c) {
            self.finishing = true;
        } else {
            self.pass += 1;
            self.index = 0;
            self.pass_start = self.next;
        }
    }

    /// Follows an edited plan: continue after the step sent last, or at the same place if it
    /// is gone. A lowered count ends the run after the current pass; a raised one continues.
    fn follow(&mut self, plan: &SeqPlan) {
        let len = plan.steps.len();
        if self.finishing {
            if plan.count.is_none_or(|c| self.pass < c) {
                self.finishing = false;
                self.pass += 1;
                self.index = 0;
                self.pass_start = self.next;
            }
            return;
        }
        let found = self.last.as_mut().and_then(|sent| {
            let now_at = plan.steps.iter().position(|s| s.id == sent.id)?;
            Some((sent, now_at))
        });
        self.index = match found {
            Some((sent, now_at)) => {
                sent.index = now_at;
                now_at + 1
            }
            None => self.index.min(len),
        };
        if self.index >= len {
            self.wrap(plan);
        }
    }
}

impl Sequencer {
    pub fn new(sink: Arc<dyn StepSink>, debug: Arc<DebugHub>) -> Self {
        Self {
            sink,
            debug,
            runs: Mutex::default(),
            progress: Mutex::default(),
            next_run: AtomicU64::new(1),
        }
    }

    /// Starts a widget's sequence from its first step, replacing a run of the same widget.
    /// Returns the new run's id. Must be called within the Tokio runtime.
    pub fn start(self: &Arc<Self>, desk: &str, widget: &str, plan: SeqPlan) -> AppResult<u64> {
        validate(&plan)?;
        let key: RunKey = (desk.to_string(), widget.to_string());
        let run = self.next_run.fetch_add(1, Ordering::Relaxed);
        self.note(
            &key,
            DebugKind::Info,
            format!(
                "sequence started: {} step(s) to {} output(s), {}",
                plan.steps.len(),
                plan.output_ids.len(),
                match plan.count {
                    Some(c) => format!("{c} pass(es)"),
                    None => "looping".into(),
                }
            ),
        );
        let (ctl, rx) = watch::channel(Desired {
            mode: Mode::Run,
            plan: Arc::new(plan),
        });
        let replaced = self
            .runs
            .lock()
            .unwrap()
            .insert(key.clone(), Handle { run, ctl });
        if let Some(old) = replaced {
            old.ctl
                .send_modify(|d| d.mode = Mode::Stop(SeqEnd::Replaced));
        }
        self.publish(SeqProgress {
            desk: key.0.clone(),
            widget: key.1.clone(),
            run,
            state: SeqState::Running,
            step: None,
            pass: 1,
            wait_ms: None,
            left_ms: None,
            at_micros: now_micros(),
            ended: None,
            late: 0,
        });
        tokio::spawn(self.clone().play(key, run, rx));
        Ok(run)
    }

    /// Gives a running sequence its edited plan; it takes effect at the next step. Nothing
    /// happens when the widget isn't running.
    pub fn update(&self, desk: &str, widget: &str, plan: SeqPlan) -> AppResult<()> {
        validate(&plan)?;
        if let Some(h) = self.runs.lock().unwrap().get(&key(desk, widget)) {
            h.ctl.send_modify(|d| d.plan = Arc::new(plan));
        }
        Ok(())
    }

    /// Holds a run where it is: it keeps what is left of the current wait for its resume.
    pub fn pause(&self, desk: &str, widget: &str) {
        self.set_mode(desk, widget, Mode::Pause);
    }

    pub fn resume(&self, desk: &str, widget: &str) {
        self.set_mode(desk, widget, Mode::Run);
    }

    pub fn stop(&self, desk: &str, widget: &str) {
        if let Some(h) = self.runs.lock().unwrap().remove(&key(desk, widget)) {
            h.ctl.send_modify(|d| d.mode = Mode::Stop(SeqEnd::Stopped));
        }
    }

    /// Stops every run of a desk that is being closed.
    pub fn stop_desk(&self, desk: &str) {
        self.runs.lock().unwrap().retain(|(d, _), h| {
            if d != desk {
                return true;
            }
            h.ctl
                .send_modify(|x| x.mode = Mode::Stop(SeqEnd::DeskClosed));
            false
        });
    }

    fn set_mode(&self, desk: &str, widget: &str, mode: Mode) {
        if let Some(h) = self.runs.lock().unwrap().get(&key(desk, widget)) {
            h.ctl.send_if_modified(|d| {
                let changed = d.mode != mode;
                d.mode = mode;
                changed
            });
        }
    }

    /// The progress since the last call, latest-wins per run; `None` if nothing changed.
    pub fn drain(&self) -> Option<SeqBatch> {
        let mut p = self.progress.lock().unwrap();
        if p.pending.is_empty() {
            return None;
        }
        Some(SeqBatch {
            runs: p.pending.drain().map(|(_, v)| v).collect(),
        })
    }

    /// Every run still going, as it is now (for a UI that subscribes after a reload).
    pub fn snapshot(&self) -> Vec<SeqProgress> {
        self.progress
            .lock()
            .unwrap()
            .current
            .values()
            .cloned()
            .collect()
    }

    fn publish(&self, p: SeqProgress) {
        let key = (p.desk.clone(), p.widget.clone());
        let mut progress = self.progress.lock().unwrap();
        if p.ended.is_some() {
            if progress.current.get(&key).is_some_and(|c| c.run == p.run) {
                progress.current.remove(&key);
            }
        } else {
            progress.current.insert(key.clone(), p.clone());
        }
        // An old run ending must not hide what its replacement reported.
        if progress.pending.get(&key).is_none_or(|q| q.run <= p.run) {
            progress.pending.insert(key, p);
        }
    }

    fn note(&self, key: &RunKey, kind: DebugKind, text: String) {
        let (message, error) = match kind {
            DebugKind::Error => (None, Some(text)),
            _ => (Some(text), None),
        };
        self.debug.push(DebugEvent {
            kind,
            desk: Some(key.0.clone()),
            endpoint_name: "sequencer".into(),
            message,
            error,
            source: Some(key.1.clone()),
            ..Default::default()
        });
    }

    async fn play(self: Arc<Self>, key: RunKey, run: u64, mut ctl: watch::Receiver<Desired>) {
        let mut plan = ctl.borrow_and_update().plan.clone();
        let now = Instant::now();
        let mut at = Cursor {
            index: 0,
            pass: 1,
            next: now,
            since: now,
            pass_start: now,
            last: None,
            finishing: false,
            late: 0,
            late_noted: None,
        };
        let end = loop {
            if let Some(end) = self.wait(&key, run, &mut ctl, &mut plan, &mut at).await {
                break end;
            }
            if at.finishing {
                break SeqEnd::Done;
            }
            let step = &plan.steps[at.index];
            self.sink
                .send_step(&key.0, &plan.output_ids, &step.message, &key.1)
                .await;
            at.last = Some(Sent {
                index: at.index,
                id: step.id.clone(),
                pass: at.pass,
            });
            at.since = at.next;
            self.schedule(&key, &plan, &mut at);
            self.publish(self.progress_of(&key, run, SeqState::Running, &at));
        };
        self.finish(&key, run, end, &at);
    }

    /// Sets the deadline of the step after the one just sent, and moves on to it.
    fn schedule(&self, key: &RunKey, plan: &SeqPlan, at: &mut Cursor) {
        let len = plan.steps.len();
        at.next += Duration::from_millis(u64::from(plan.steps[at.index].delay_ms));
        let wrapped = at.index + 1 >= len;
        if wrapped {
            at.next = at.next.max(at.pass_start + pass_floor(len));
        }
        let now = Instant::now();
        if at.next < now {
            at.next = now;
            at.late += 1;
            if at.late_noted.is_none_or(|t| now - t >= LATE_NOTE_EVERY) {
                at.late_noted = Some(now);
                self.note(
                    key,
                    DebugKind::Error,
                    "sequence fell behind: resynced to now (steps are never sent in a burst)"
                        .into(),
                );
            }
        }
        if wrapped {
            at.wrap(plan);
        } else {
            at.index += 1;
        }
    }

    /// Waits for the next deadline while following the UI: a new plan, pause and resume, stop.
    /// Returns why the run ends, if it does.
    async fn wait(
        &self,
        key: &RunKey,
        run: u64,
        ctl: &mut watch::Receiver<Desired>,
        plan: &mut Arc<SeqPlan>,
        at: &mut Cursor,
    ) -> Option<SeqEnd> {
        let mut paused_at: Option<Instant> = None;
        loop {
            let desired = ctl.borrow_and_update().clone();
            if !Arc::ptr_eq(&desired.plan, plan) {
                *plan = desired.plan;
                at.follow(plan);
            }
            match desired.mode {
                Mode::Stop(end) => return Some(end),
                Mode::Pause => {
                    if paused_at.is_none() {
                        paused_at = Some(Instant::now());
                        self.publish(self.progress_of(key, run, SeqState::Paused, at));
                    }
                    if ctl.changed().await.is_err() {
                        return Some(SeqEnd::Stopped);
                    }
                }
                Mode::Run => {
                    if let Some(since) = paused_at.take() {
                        // What was left of the wait is kept: everything moves by the pause.
                        let gap = Instant::now() - since;
                        at.next += gap;
                        at.since += gap;
                        at.pass_start += gap;
                        self.publish(self.progress_of(key, run, SeqState::Running, at));
                    }
                    tokio::select! {
                        () = sleep_until(at.next) => return None,
                        changed = ctl.changed() => {
                            if changed.is_err() {
                                return Some(SeqEnd::Stopped);
                            }
                        }
                    }
                }
            }
        }
    }

    fn progress_of(&self, key: &RunKey, run: u64, state: SeqState, at: &Cursor) -> SeqProgress {
        let ms = |d: Duration| u32::try_from(d.as_millis()).unwrap_or(u32::MAX);
        let waiting = at.last.is_some();
        SeqProgress {
            desk: key.0.clone(),
            widget: key.1.clone(),
            run,
            state,
            step: at.last.as_ref().map(|s| s.index as u32),
            pass: at.last.as_ref().map_or(at.pass, |s| s.pass),
            wait_ms: waiting.then(|| ms(at.next - at.since)),
            left_ms: waiting.then(|| ms(at.next.saturating_duration_since(Instant::now()))),
            at_micros: now_micros(),
            ended: None,
            late: at.late,
        }
    }

    fn finish(&self, key: &RunKey, run: u64, end: SeqEnd, at: &Cursor) {
        {
            let mut runs = self.runs.lock().unwrap();
            if runs.get(key).is_some_and(|h| h.run == run) {
                runs.remove(key);
            }
        }
        self.publish(SeqProgress {
            ended: Some(end),
            ..self.progress_of(key, run, SeqState::Stopped, at)
        });
        let text = match end {
            SeqEnd::Done => format!("sequence finished after {} pass(es)", at.pass),
            SeqEnd::Stopped => "sequence stopped".into(),
            SeqEnd::DeskClosed => "sequence stopped: its desk was closed".into(),
            // The new start says so.
            SeqEnd::Replaced => return,
        };
        self.note(key, DebugKind::Info, text);
    }
}

fn key(desk: &str, widget: &str) -> RunKey {
    (desk.to_string(), widget.to_string())
}

/// A plan the sequencer can play: within the limits, sent somewhere, every step encodable.
fn validate(plan: &SeqPlan) -> AppResult<()> {
    let fail = |msg: String| Err(AppError::Sequencer(msg));
    if plan.steps.is_empty() || plan.steps.len() > LIMITS.max_steps {
        return fail(format!("a sequence has 1-{} steps", LIMITS.max_steps));
    }
    if plan.output_ids.is_empty() {
        return fail("the sequence sends to no output".into());
    }
    if let Some(id) = plan.output_ids.iter().find(|id| !valid_id(id)) {
        return fail(format!("invalid output id '{id}'"));
    }
    if let Some(c) = plan.count {
        if c == 0 || c > LIMITS.max_count {
            return fail(format!("a sequence plays 1-{} passes", LIMITS.max_count));
        }
    }
    for (i, step) in plan.steps.iter().enumerate() {
        if step.delay_ms > LIMITS.max_delay_ms {
            return fail(format!(
                "step {}: waits longer than {} ms",
                i + 1,
                LIMITS.max_delay_ms
            ));
        }
        encode_message(&step.message)
            .map_err(|e| AppError::Sequencer(format!("step {}: {e}", i + 1)))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::osc::OscArg;
    use std::sync::Mutex as StdMutex;

    /// Records each step with the (virtual) time it was sent at; optionally slow.
    struct Recorder {
        t0: Instant,
        sent: StdMutex<Vec<(u64, String)>>,
        busy: Duration,
    }

    impl StepSink for Recorder {
        fn send_step<'a>(
            &'a self,
            _desk: &'a str,
            _output_ids: &'a [String],
            message: &'a OscMessage,
            _source: &'a str,
        ) -> Pin<Box<dyn Future<Output = ()> + Send + 'a>> {
            Box::pin(async move {
                let at = (Instant::now() - self.t0).as_millis() as u64;
                self.sent
                    .lock()
                    .unwrap()
                    .push((at, message.address.clone()));
                if !self.busy.is_zero() {
                    tokio::time::sleep(self.busy).await;
                }
            })
        }
    }

    fn setup(busy_ms: u64) -> (Arc<Sequencer>, Arc<Recorder>, Arc<DebugHub>) {
        let rec = Arc::new(Recorder {
            t0: Instant::now(),
            sent: StdMutex::default(),
            busy: Duration::from_millis(busy_ms),
        });
        let debug = Arc::new(DebugHub::new(100, 100));
        (
            Arc::new(Sequencer::new(rec.clone(), debug.clone())),
            rec,
            debug,
        )
    }

    fn step(id: &str, delay_ms: u32) -> SeqStep {
        SeqStep {
            id: id.into(),
            message: OscMessage {
                address: format!("/{id}"),
                args: vec![OscArg::Int(1)],
            },
            delay_ms,
        }
    }

    fn plan(steps: Vec<SeqStep>, count: Option<u32>) -> SeqPlan {
        SeqPlan {
            output_ids: vec!["out".into()],
            steps,
            count,
        }
    }

    fn sent(rec: &Recorder) -> Vec<(u64, String)> {
        rec.sent.lock().unwrap().clone()
    }

    fn at(ms: u64, id: &str) -> (u64, String) {
        (ms, format!("/{id}"))
    }

    async fn after(ms: u64) {
        tokio::time::sleep(Duration::from_millis(ms)).await;
    }

    fn last_of(seq: &Sequencer, widget: &str) -> Option<SeqProgress> {
        seq.drain()?.runs.into_iter().find(|p| p.widget == widget)
    }

    #[tokio::test(start_paused = true)]
    async fn plays_each_step_after_the_waits_before_it() {
        let (seq, rec, _) = setup(0);
        seq.start("d", "w", plan(vec![step("a", 100), step("b", 50)], None))
            .unwrap();
        after(420).await;
        assert_eq!(
            sent(&rec),
            [
                at(0, "a"),
                at(100, "b"),
                at(150, "a"),
                at(250, "b"),
                at(300, "a"),
                at(400, "b")
            ]
        );
    }

    #[tokio::test(start_paused = true)]
    async fn plays_count_passes_then_ends_done_after_the_last_wait() {
        let (seq, rec, debug) = setup(0);
        seq.start("d", "w", plan(vec![step("a", 100)], Some(2)))
            .unwrap();
        after(150).await;
        assert!(
            seq.snapshot().iter().any(|p| p.widget == "w"),
            "still in pass 2"
        );
        after(100).await;
        assert_eq!(sent(&rec), [at(0, "a"), at(100, "a")]);
        let last = last_of(&seq, "w").unwrap();
        assert_eq!(
            (last.state, last.ended, last.pass),
            (SeqState::Stopped, Some(SeqEnd::Done), 2)
        );
        assert!(seq.snapshot().is_empty());
        assert!(debug
            .history()
            .iter()
            .any(|e| e.message.as_deref() == Some("sequence finished after 2 pass(es)")));
    }

    #[tokio::test(start_paused = true)]
    async fn a_slow_output_does_not_make_it_drift() {
        let (seq, rec, _) = setup(30);
        seq.start("d", "w", plan(vec![step("a", 100)], None))
            .unwrap();
        after(350).await;
        assert_eq!(
            sent(&rec),
            [at(0, "a"), at(100, "a"), at(200, "a"), at(300, "a")]
        );
    }

    #[tokio::test(start_paused = true)]
    async fn falling_behind_resyncs_without_a_burst() {
        let (seq, rec, debug) = setup(250);
        seq.start("d", "w", plan(vec![step("a", 100)], None))
            .unwrap();
        after(800).await;
        // Each send takes 250 ms: every step is late, and each goes out once, right away.
        assert_eq!(
            sent(&rec),
            [at(0, "a"), at(250, "a"), at(500, "a"), at(750, "a")]
        );
        let late = debug
            .history()
            .iter()
            .filter(|e| {
                e.error
                    .as_deref()
                    .is_some_and(|m| m.contains("fell behind"))
            })
            .count();
        assert_eq!(late, 1, "noted at most once a second");
    }

    #[tokio::test(start_paused = true)]
    async fn pause_keeps_the_rest_of_the_wait() {
        let (seq, rec, _) = setup(0);
        seq.start("d", "w", plan(vec![step("a", 100), step("b", 100)], None))
            .unwrap();
        after(30).await;
        seq.pause("d", "w");
        after(470).await;
        assert_eq!(sent(&rec), [at(0, "a")]);
        let paused = last_of(&seq, "w").unwrap();
        assert_eq!(
            (paused.state, paused.wait_ms, paused.left_ms),
            (SeqState::Paused, Some(100), Some(70))
        );
        seq.resume("d", "w");
        for _ in 0..4 {
            tokio::task::yield_now().await; // let the run see it, without time passing
        }
        let resumed = last_of(&seq, "w").unwrap();
        assert_eq!(
            (resumed.state, resumed.wait_ms, resumed.left_ms),
            (SeqState::Running, Some(100), Some(70)),
            "the wait keeps its length and what was left of it"
        );
        after(80).await;
        assert_eq!(sent(&rec), [at(0, "a"), at(570, "b")]);
    }

    #[tokio::test(start_paused = true)]
    async fn stop_lets_a_send_in_progress_finish_and_nothing_follows() {
        let (seq, rec, _) = setup(40);
        seq.start("d", "w", plan(vec![step("a", 50)], None))
            .unwrap();
        after(10).await;
        seq.stop("d", "w");
        after(500).await;
        assert_eq!(sent(&rec), [at(0, "a")]);
        let last = last_of(&seq, "w").unwrap();
        assert_eq!(last.ended, Some(SeqEnd::Stopped));
    }

    #[tokio::test(start_paused = true)]
    async fn an_edit_continues_after_the_step_sent_last() {
        let (seq, rec, _) = setup(0);
        seq.start(
            "d",
            "w",
            plan(vec![step("a", 100), step("b", 100), step("c", 100)], None),
        )
        .unwrap();
        after(150).await; // a and b sent; c is next
        seq.update(
            "d",
            "w",
            plan(vec![step("b", 100), step("x", 100), step("c", 100)], None),
        )
        .unwrap();
        after(100).await;
        assert_eq!(sent(&rec), [at(0, "a"), at(100, "b"), at(200, "x")]);
    }

    #[tokio::test(start_paused = true)]
    async fn a_lowered_count_ends_after_the_current_pass() {
        let (seq, rec, _) = setup(0);
        seq.start("d", "w", plan(vec![step("a", 100), step("b", 100)], None))
            .unwrap();
        after(250).await; // pass 2 has begun
        seq.update(
            "d",
            "w",
            plan(vec![step("a", 100), step("b", 100)], Some(1)),
        )
        .unwrap();
        after(500).await;
        assert_eq!(
            sent(&rec),
            [at(0, "a"), at(100, "b"), at(200, "a"), at(300, "b")]
        );
    }

    #[tokio::test(start_paused = true)]
    async fn a_pass_never_takes_less_than_the_floor() {
        let (seq, rec, _) = setup(0);
        seq.start("d", "w", plan(vec![step("a", 0), step("b", 0)], None))
            .unwrap();
        after(25).await;
        assert_eq!(
            sent(&rec),
            [
                at(0, "a"),
                at(0, "b"),
                at(10, "a"),
                at(10, "b"),
                at(20, "a"),
                at(20, "b")
            ]
        );
        assert_eq!(pass_floor(64), Duration::from_millis(64));
    }

    #[tokio::test(start_paused = true)]
    async fn a_new_start_replaces_the_run() {
        let (seq, rec, _) = setup(0);
        let first = seq
            .start("d", "w", plan(vec![step("a", 100)], None))
            .unwrap();
        after(50).await;
        let second = seq
            .start("d", "w", plan(vec![step("b", 100)], None))
            .unwrap();
        assert!(second > first);
        after(120).await;
        assert_eq!(sent(&rec), [at(0, "a"), at(50, "b"), at(150, "b")]);
        let current = seq.snapshot();
        assert_eq!(current.len(), 1);
        assert_eq!(current[0].run, second);
    }

    #[tokio::test(start_paused = true)]
    async fn closing_a_desk_stops_only_its_runs() {
        let (seq, _, _) = setup(0);
        seq.start("d1", "w", plan(vec![step("a", 100)], None))
            .unwrap();
        seq.start("d2", "w", plan(vec![step("a", 100)], None))
            .unwrap();
        after(10).await;
        seq.stop_desk("d1");
        after(10).await;
        let current = seq.snapshot();
        assert_eq!(current.len(), 1);
        assert_eq!(current[0].desk, "d2");
    }

    #[tokio::test(start_paused = true)]
    async fn an_invalid_plan_sends_nothing() {
        let (seq, rec, _) = setup(0);
        let bad_address = SeqStep {
            message: OscMessage {
                address: "no-slash".into(),
                args: vec![],
            },
            ..step("a", 10)
        };
        assert!(seq.start("d", "w", plan(vec![bad_address], None)).is_err());
        assert!(seq.start("d", "w", plan(vec![], None)).is_err());
        assert!(seq
            .start("d", "w", plan(vec![step("a", 10)], Some(0)))
            .is_err());
        let nowhere = SeqPlan {
            output_ids: vec![],
            ..plan(vec![step("a", 10)], None)
        };
        assert!(seq.start("d", "w", nowhere).is_err());
        let too_long = step("a", LIMITS.max_delay_ms + 1);
        assert!(seq.start("d", "w", plan(vec![too_long], None)).is_err());
        after(100).await;
        assert!(sent(&rec).is_empty());
        assert!(seq.snapshot().is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn progress_is_latest_wins_per_run() {
        let (seq, _, _) = setup(0);
        seq.start("d", "w", plan(vec![step("a", 10), step("b", 10)], None))
            .unwrap();
        after(35).await;
        let batch = seq.drain().unwrap();
        assert_eq!(batch.runs.len(), 1);
        let p = &batch.runs[0];
        assert_eq!((p.step, p.pass, p.state), (Some(1), 2, SeqState::Running));
        // Sent at 30 ms, waiting 10 ms for the next pass.
        assert_eq!((p.wait_ms, p.left_ms), (Some(10), Some(10)));
        assert!(p.at_micros > 0);
        assert!(seq.drain().is_none());
    }
}
