// Input mapping's state for the UI: the master gate (mirrored from Rust, which enforces it),
// what happened to each inbound packet (shown in TRAFFIC), and widgets whose forwarding was
// stopped by the loop breaker.
import { input as inputIpc } from '../ipc/commands';
import { errorText } from '../util';
import { debugStore } from './debug.svelte';

/** What input mapping did with one message of an inbound packet. */
export interface Outcome {
  result:
    | 'applied'
    | 'forwarded'
    | 'coalesced'
    | 'touched'
    | 'own echo'
    | 'ignored'
    | 'no match'
    | 'dropped'
    | 'forward stopped';
  /** The widget concerned, if any. */
  widget?: string;
}

const KEEP_OUTCOMES = 5000;

class InputStore {
  /** The IN switch: whether inbound OSC may drive widgets. */
  enabled = $state(false);
  /** Messages Rust discarded because they arrived faster than the UI took them. */
  totalDropped = $state(0);
  /** Widgets whose forwarding the loop breaker stopped (until re-armed). */
  tripped: Record<string, true> = $state({});
  /** Bumped when outcomes change, so readers of `outcomeOf` re-run. */
  outcomeVersion = $state(0);

  private outcomes = new Map<number, Outcome[]>();

  async setEnabled(enabled: boolean) {
    try {
      this.enabled = await inputIpc.setEnabled(enabled);
    } catch (e) {
      debugStore.local(`input switch failed: ${errorText(e)}`, undefined, 'input');
    }
  }

  outcomeOf(seq: number): Outcome[] | undefined {
    void this.outcomeVersion;
    return this.outcomes.get(seq);
  }

  record(outcomes: Map<number, Outcome[]>) {
    if (outcomes.size === 0) return;
    for (const [seq, list] of outcomes) this.outcomes.set(seq, list);
    while (this.outcomes.size > KEEP_OUTCOMES) {
      this.outcomes.delete(this.outcomes.keys().next().value!);
    }
    this.outcomeVersion++;
  }
}

export const inputStore = new InputStore();
