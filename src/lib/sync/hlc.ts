// A hybrid logical clock: stamps that follow wall time but never go backwards, and that order
// every change across devices the same way everywhere. A stamp is [wall ms, counter, peer
// id]; the counter orders changes within one millisecond, the peer id breaks exact ties.
import type { Stamp } from './protocol';

/** A stamp further ahead of this device's clock than this is refused (a peer's clock is off). */
export const MAX_AHEAD_MS = 60_000;
const MAX_COUNTER = 0xffff;

/** Total order: wall time, then counter, then peer id. */
export function compareStamps(a: Stamp, b: Stamp): number {
  return a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0);
}

export const newer = (a: Stamp, b: Stamp | undefined) => !b || compareStamps(a, b) > 0;

export class Hlc {
  private wall = 0;
  private counter = 0;

  constructor(
    readonly peer: string,
    private clock: () => number = Date.now,
  ) {}

  /** A stamp for a change made now, later than every stamp made or seen before. */
  now(): Stamp {
    const t = this.clock();
    if (t > this.wall) {
      this.wall = t;
      this.counter = 0;
    } else if (this.counter < MAX_COUNTER) {
      this.counter++;
    } else {
      // More than 65536 changes in one ms (or a clock stuck behind): borrow the next ms.
      this.wall++;
      this.counter = 0;
    }
    return [this.wall, this.counter, this.peer];
  }

  /**
   * Takes in a stamp from elsewhere (a peer, or a saved record) so later stamps follow it.
   * Returns false, without taking it in, if it is too far in the future.
   */
  observe(stamp: Stamp): boolean {
    if (stamp[0] > this.clock() + MAX_AHEAD_MS) return false;
    if (stamp[0] > this.wall) {
      this.wall = stamp[0];
      this.counter = stamp[1];
    } else if (stamp[0] === this.wall && stamp[1] > this.counter) {
      this.counter = stamp[1];
    }
    return true;
  }

  /**
   * Starts after a saved stamp, however far ahead: a change made now must never lose to one
   * saved earlier, even if the clock was wrong back then.
   */
  seed(stamp: Stamp) {
    if (stamp[0] > this.wall || (stamp[0] === this.wall && stamp[1] > this.counter)) {
      this.wall = stamp[0];
      this.counter = stamp[1];
    }
  }

  /** How far ahead of this device a stamp is, in ms (for "clock off by N s" warnings). */
  aheadBy(stamp: Stamp): number {
    return stamp[0] - this.clock();
  }
}
