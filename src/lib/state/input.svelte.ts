// Input mapping's state for the UI: the master gate (mirrored from Rust, which enforces it),
// what happened to each inbound packet (shown in TRAFFIC), the messages each widget received
// (a log widget's IN rows), and widgets whose forwarding was stopped by the loop breaker.
import { input as inputIpc } from '../ipc/commands';
import type { InboundMessage } from '../ipc/types';
import { LIMITS } from '../model/preset';
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
  /** The widget concerned (its label), if any. */
  widget?: string;
}

/** A received message that reached a widget, and what input mapping did with it. */
export interface Received {
  /** Unique among received rows (a bundle's messages share their packet's seq). */
  id: number;
  widgetId: string;
  msg: InboundMessage;
  result: Outcome['result'];
}

const KEEP_OUTCOMES = 5000;
/** Per widget: as many as a log widget can show. */
const KEEP_RECEIVED = LIMITS.logRows.max;

class InputStore {
  /** The OSC-IN switch: whether inbound OSC may drive widgets. */
  enabled = $state(false);
  /** Messages Rust discarded because they arrived faster than the UI took them. */
  totalDropped = $state(0);
  /** Widgets whose forwarding the loop breaker stopped (until re-armed). */
  tripped: Record<string, true> = $state({});
  /** Bumped when outcomes change, so readers of `outcomeOf` re-run. */
  outcomeVersion = $state(0);

  private outcomes = new Map<number, Outcome[]>();
  private received = new Map<string, Received[]>();
  private receivedIds = 0;

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

  /** The messages a widget received, oldest first (reactive). */
  receivedFor(widgetId: string): readonly Received[] {
    void this.outcomeVersion;
    return this.received.get(widgetId) ?? [];
  }

  record(outcomes: Map<number, Outcome[]>, received: readonly Omit<Received, 'id'>[] = []) {
    if (outcomes.size === 0 && received.length === 0) return;
    for (const [seq, list] of outcomes) this.outcomes.set(seq, list);
    while (this.outcomes.size > KEEP_OUTCOMES) {
      this.outcomes.delete(this.outcomes.keys().next().value!);
    }
    for (const r of received) {
      const list = this.received.get(r.widgetId) ?? [];
      list.push({ ...r, id: ++this.receivedIds });
      if (list.length > KEEP_RECEIVED) list.shift();
      this.received.set(r.widgetId, list);
    }
    this.outcomeVersion++;
  }

  /** Drops a removed widget's received messages. */
  forget(widgetId: string) {
    if (this.received.delete(widgetId)) this.outcomeVersion++;
  }
}

export const inputStore = new InputStore();
