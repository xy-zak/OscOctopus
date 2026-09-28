// Sequencer runs as the UI sees them: a mirror of the Rust core's (src-tauri/src/sequencer.rs),
// keyed by widget id so it outlives the widget's component, which unmounts when you leave the
// desk. These are this device's own runs: a sequence plays where it was started, and nothing
// here is synced.
//
// - Starting, pausing and stopping are this device's actions (a press). A widget that isn't on
//   an open desk (a preview) never starts.
// - An edit made here reaches a running sequence at its next step. An edit from another device
//   doesn't (nothing a peer sends is sent on): it applies at the next START, and the widget says
//   so meanwhile (`edited`).
// - A widget that goes away (removed, its desk replaced or closed) stops its run.
// - Progress arrives in batches, latest per run. Run ids only increase, so progress of an
//   earlier run of the same widget (a replaced one ending late) is ignored.
import { canonical } from '../canonical';
import { seq as seqIpc } from '../ipc/commands';
import type { SeqProgress } from '../ipc/types';
import type { Preset, SequencerWidget } from '../model/preset';
import { errorText } from '../util';
import { STOPPED } from '../widgets/sequencer/def';
import { startProblem, toPlan } from '../widgets/sequencer/plan';
import { deskChanges } from './changes';
import { debugStore } from './debug.svelte';
import { presetStore } from './preset.svelte';
import { toast } from './ui.svelte';
import { values } from './values.svelte';

/** An edit waits this long for the next keystroke before it goes to the running sequence. */
const UPDATE_AFTER_MS = 150;

export interface SeqRun {
  desk: string;
  run: number;
  state: 'running' | 'paused';
  /** The step sent last (0-based); null before the first. */
  step: number | null;
  pass: number;
  /** The wait after the step sent last, in ms, and what was left of it at `atMicros`. */
  waitMs: number | null;
  leftMs: number | null;
  /** When the core reported it (wall-clock µs), so the wait bar starts where the run is. */
  atMicros: number;
  /** How often it fell behind and resynced. */
  late: number;
}

function sequencerOf(id: string): { desk: Preset; widget: SequencerWidget } | undefined {
  const found = presetStore.findWidget(id);
  return found?.widget.type === 'sequencer'
    ? { desk: found.desk, widget: found.widget }
    : undefined;
}

class SequencerStore {
  /** Runs going on this device, by widget id. */
  runs: Record<string, SeqRun> = $state({});
  /** Running sequences edited on another device: the edit applies at the next START. */
  edited: Record<string, true> = $state({});

  private started = false;
  /** The newest run id seen per widget. */
  private latest = new Map<string, number>();
  /** The plan last given to Rust per running widget (canonical JSON). */
  private sent = new Map<string, string>();
  private updates = new Map<string, ReturnType<typeof setTimeout>>();

  /** Subscribes to the core's progress. Idempotent; call once the desks are open. */
  async start() {
    if (this.started) return;
    this.started = true;
    deskChanges.on((c) => this.deskChanged(c.deskId, c.origin));
    const going = await seqIpc.subscribe((batch) => batch.runs.forEach((p) => this.apply(p)));
    going.forEach((p) => this.apply(p));
  }

  /** Plays a sequencer from its first step (again, if it was running). */
  async play(widgetId: string) {
    const found = sequencerOf(widgetId);
    if (!found) return;
    const { desk, widget } = found;
    const problem = startProblem(widget);
    if (problem) {
      toast(`${widget.label || 'Sequencer'} can’t start: ${problem}`, 'error');
      return;
    }
    const plan = toPlan(widget);
    try {
      const run = await seqIpc.start(desk.id, widget.id, plan);
      this.latest.set(widget.id, Math.max(run, this.latest.get(widget.id) ?? 0));
      this.sent.set(widget.id, canonical(plan));
      delete this.edited[widget.id];
    } catch (e) {
      this.failed(widget.id, 'start', e);
    }
  }

  pause(widgetId: string) {
    this.control(widgetId, 'pause', seqIpc.pause);
  }

  resume(widgetId: string) {
    this.control(widgetId, 'resume', seqIpc.resume);
  }

  stop(widgetId: string) {
    this.control(widgetId, 'stop', seqIpc.stop);
  }

  private control(
    widgetId: string,
    what: string,
    call: (desk: string, widget: string) => Promise<void>,
  ) {
    const run = this.runs[widgetId];
    if (run) call(run.desk, widgetId).catch((e: unknown) => this.failed(widgetId, what, e));
  }

  private failed(widgetId: string, what: string, e: unknown) {
    const text = `sequencer ${what} failed: ${errorText(e)}`;
    debugStore.local(text, widgetId, 'sequencer');
    toast(text, 'error');
  }

  private apply(p: SeqProgress) {
    if (p.run < (this.latest.get(p.widget) ?? 0)) return;
    this.latest.set(p.widget, p.run);
    const here = sequencerOf(p.widget);
    if (p.ended || !here) {
      if (!p.ended) void seqIpc.stop(p.desk, p.widget);
      this.forget(p.widget);
      if (here) values[p.widget] = { ...STOPPED };
      return;
    }
    const state = p.state === 'paused' ? 'paused' : 'running';
    this.runs[p.widget] = {
      desk: p.desk,
      run: p.run,
      state,
      step: p.step,
      pass: p.pass,
      waitMs: p.waitMs,
      leftMs: p.leftMs,
      atMicros: p.atMicros,
      late: p.late,
    };
    values[p.widget] = { state, step: (p.step ?? -1) + 1, pass: p.pass };
  }

  private forget(widgetId: string) {
    delete this.runs[widgetId];
    delete this.edited[widgetId];
    this.sent.delete(widgetId);
    clearTimeout(this.updates.get(widgetId));
    this.updates.delete(widgetId);
  }

  /** A desk changed: its running sequences follow edits made here, and stop when removed. */
  private deskChanged(deskId: string, origin: 'local' | 'remote') {
    for (const [id, run] of Object.entries(this.runs)) {
      if (run.desk !== deskId) continue;
      const found = sequencerOf(id);
      if (!found) {
        void seqIpc.stop(run.desk, id);
        continue;
      }
      if (canonical(toPlan(found.widget)) === this.sent.get(id)) continue;
      if (origin === 'remote') {
        this.edited[id] = true;
        continue;
      }
      clearTimeout(this.updates.get(id));
      this.updates.set(
        id,
        setTimeout(() => void this.update(id), UPDATE_AFTER_MS),
      );
    }
  }

  private async update(widgetId: string) {
    this.updates.delete(widgetId);
    const found = sequencerOf(widgetId);
    const run = this.runs[widgetId];
    // Half-typed (an address without its '/'): the run keeps its plan until it is valid.
    if (!found || !run || startProblem(found.widget)) return;
    const plan = toPlan(found.widget);
    try {
      await seqIpc.update(run.desk, widgetId, plan);
      this.sent.set(widgetId, canonical(plan));
      delete this.edited[widgetId];
    } catch (e) {
      this.failed(widgetId, 'update', e);
    }
  }
}

export const sequencerStore = new SequencerStore();
