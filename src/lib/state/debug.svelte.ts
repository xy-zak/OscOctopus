// Client side of the debug pipeline. Receives batched events from Rust, keeps a bounded log,
// and tracks anything that would otherwise be invisible: dropped events, sequence gaps,
// values coalesced by the throttle, and IPC failures that never reached Rust.
import { debug as debugIpc } from '../ipc/commands';
import type { DebugBatch, DebugEvent } from '../ipc/types';
import type { ThrottleStats } from '../osc/throttle';

const UI_CAP = 5000;
const PER_SOURCE_CAP = 12;

class DebugStore {
  /** Displayed log, oldest first. Replaced (never mutated) so the list re-renders cheaply. */
  events: DebugEvent[] = $state.raw([]);
  paused = $state(false);
  /** Events received while paused, not yet shown. */
  heldCount = $state(0);
  /** Reported by Rust: events it discarded because the UI fell behind. */
  totalDropped = $state(0);
  /** Missing sequence numbers not explained by reported drops (should always be 0). */
  unexplainedGaps = $state(0);
  lastSeq = $state(0);
  /** Throttle counters per widget id. */
  throttle: Record<string, ThrottleStats> = $state({});
  /** Bumped when bySource changes, so readers of recentFor() re-run. */
  sourceVersion = $state(0);

  private held: DebugEvent[] = [];
  private bySource = new Map<string, DebugEvent[]>();
  private started = false;

  async start() {
    if (this.started) return;
    this.started = true;
    // Batches can arrive before the history call resolves; buffer them so events stay ordered.
    let early: DebugBatch[] | null = [];
    const history = await debugIpc.subscribe((batch) => {
      if (early) early.push(batch);
      else this.ingest(batch);
    });
    this.ingest({ events: history, dropped: 0, totalDropped: 0 });
    const queued = early;
    early = null;
    queued.forEach((b) => this.ingest(b));
  }

  private ingest(batch: DebugBatch) {
    this.totalDropped = Math.max(this.totalDropped, batch.totalDropped);
    const fresh = batch.events.filter((e) => e.seq > this.lastSeq);
    if (fresh.length === 0) return;
    const expected = fresh[fresh.length - 1]!.seq - this.lastSeq;
    if (this.lastSeq > 0) {
      const gap = expected - fresh.length - Number(batch.dropped);
      if (gap > 0) this.unexplainedGaps += gap;
    }
    this.lastSeq = fresh[fresh.length - 1]!.seq;
    this.index(fresh);
    this.append(fresh);
  }

  /** Records a failure that happened in the UI / IPC layer and never reached Rust. */
  local(error: string, source?: string, endpointName = 'ui') {
    this.record('error', error, source, endpointName);
  }

  /** Records something worth knowing that happened in the UI (e.g. a peer's edit). */
  note(message: string, endpointName = 'ui') {
    this.record('info', message, undefined, endpointName);
  }

  private record(
    kind: 'error' | 'info',
    text: string,
    source: string | undefined,
    endpointName: string,
  ) {
    const ev: DebugEvent = {
      seq: 0,
      tsMicros: Math.round((performance.timeOrigin + performance.now()) * 1000),
      kind,
      direction: null,
      desk: null,
      endpointId: '',
      endpointName,
      transport: null,
      local: null,
      remote: null,
      bytes: [],
      wireLen: null,
      decoded: null,
      decodeError: null,
      error: kind === 'error' ? text : null,
      message: kind === 'info' ? text : null,
      source: source ?? null,
      blocked: false,
      origin: null,
    };
    this.index([ev]);
    this.append([ev]);
  }

  private append(fresh: DebugEvent[]) {
    if (this.paused) {
      this.held.push(...fresh);
      if (this.held.length > UI_CAP) this.held.splice(0, this.held.length - UI_CAP);
      this.heldCount = this.held.length;
      return;
    }
    const keep = Math.max(0, UI_CAP - fresh.length);
    this.events = [...this.events.slice(-keep), ...fresh.slice(-UI_CAP)];
  }

  private index(fresh: DebugEvent[]) {
    let changed = false;
    for (const e of fresh) {
      if (!e.source) continue;
      const list = this.bySource.get(e.source) ?? [];
      list.push(e);
      if (list.length > PER_SOURCE_CAP) list.shift();
      this.bySource.set(e.source, list);
      changed = true;
    }
    if (changed) this.sourceVersion++;
  }

  /** Most recent events caused by a widget (reactive). */
  recentFor(widgetId: string): DebugEvent[] {
    void this.sourceVersion;
    return this.bySource.get(widgetId) ?? [];
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    if (!paused && this.held.length) {
      const held = this.held;
      this.held = [];
      this.heldCount = 0;
      this.append(held);
    }
  }

  async clear() {
    this.events = [];
    this.held = [];
    this.heldCount = 0;
    this.bySource.clear();
    this.sourceVersion++;
    await debugIpc.clear();
  }
}

export const debugStore = new DebugStore();
