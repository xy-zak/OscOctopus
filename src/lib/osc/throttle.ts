// Per-widget send gate. Guarantees, in order of importance:
//   1. The last value pushed is always sent (a fader never stops short of where you let go).
//   2. At most one send is in flight, so messages can't reach the socket out of order.
//   3. At most `maxHz` sends per second while dragging.
// Values replaced before they could be sent are counted as `coalesced` and shown in the UI.
// With a `merge` function, a held-back value is combined with the next one instead of being
// replaced (an encoder's +1 +1 +1 becomes +3, so no turns are lost).
//
// Discrete widgets (buttons, pads, lists) use `OrderedQueue` instead: every event is a fact
// (a pad hit, a selection) and must be sent, in order, never coalesced.

export interface ThrottleStats {
  sent: number;
  coalesced: number;
  failed: number;
}

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realClock: Clock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class Throttle<T> {
  readonly stats: ThrottleStats = { sent: 0, coalesced: 0, failed: 0 };
  private pending: { value: T } | null = null;
  private inFlight = false;
  private lastSend = -Infinity;
  private timer: unknown = null;

  constructor(
    private send: (value: T) => Promise<unknown>,
    public maxHz: number,
    private clock: Clock = realClock,
    private onStats?: (s: ThrottleStats) => void,
    private merge?: (held: T, next: T) => T,
  ) {}

  push(value: T): void {
    if (this.pending) {
      this.stats.coalesced++;
      this.pending = { value: this.merge ? this.merge(this.pending.value, value) : value };
    } else {
      this.pending = { value };
    }
    this.pump();
  }

  /** Send the pending value as soon as nothing is in flight, ignoring the rate limit. */
  flush(): void {
    this.lastSend = -Infinity;
    this.pump();
  }

  private interval(): number {
    return this.maxHz > 0 ? 1000 / this.maxHz : 0;
  }

  private pump(): void {
    if (!this.pending || this.inFlight) return;
    const wait = this.lastSend + this.interval() - this.clock.now();
    if (wait > 0) {
      if (this.timer === null) {
        this.timer = this.clock.setTimeout(() => {
          this.timer = null;
          this.pump();
        }, wait);
      }
      return;
    }
    if (this.timer !== null) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
    const { value } = this.pending;
    this.pending = null;
    this.inFlight = true;
    this.lastSend = this.clock.now();
    this.send(value)
      .then(
        () => void this.stats.sent++,
        () => void this.stats.failed++,
      )
      .finally(() => {
        this.inFlight = false;
        this.onStats?.(this.stats);
        this.pump();
      });
  }
}

/** Sends every pushed value, in order, one at a time. Nothing is ever dropped or merged. */
export class OrderedQueue<T> {
  readonly stats: ThrottleStats = { sent: 0, coalesced: 0, failed: 0 };
  private queue: T[] = [];
  private inFlight = false;

  constructor(
    private send: (value: T) => Promise<unknown>,
    private onStats?: (s: ThrottleStats) => void,
  ) {}

  push(value: T): void {
    this.queue.push(value);
    this.pump();
  }

  /** Queued values already go out as fast as possible. */
  flush(): void {}

  private pump(): void {
    if (this.inFlight || this.queue.length === 0) return;
    const value = this.queue.shift() as T;
    this.inFlight = true;
    this.send(value)
      .then(
        () => void this.stats.sent++,
        () => void this.stats.failed++,
      )
      .finally(() => {
        this.inFlight = false;
        this.onStats?.(this.stats);
        this.pump();
      });
  }
}
