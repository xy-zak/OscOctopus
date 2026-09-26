// Connects widget interaction to the wire: value → gate → messages → osc_send.
//
// Each widget's def says how its values travel (`Gate` in widgets/types.ts):
//   - queue: discrete events (button, switch, pads, list) go through an OrderedQueue: every
//     press, hit or selection is sent, in order, never merged away.
//   - throttle: continuous values (fader, graph, bounded knob) go through a rate-limited
//     Throttle: under a fast drag only the newest value matters, and the resting value
//     always goes out.
//   - merge: the endless knob's Throttle merges held-back values (+1 +1 +1 → +3) instead of
//     replacing them, so no turns are lost.
import { osc } from '../ipc/commands';
import type { Widget } from '../model/preset';
import { debugStore } from '../state/debug.svelte';
import { presetStore } from '../state/preset.svelte';
import { values } from '../state/values.svelte';
import { errorText } from '../util';
import { gateFor } from '../widgets/defs';
import type { Gate } from '../widgets/types';
import { buildMessages } from './mapping';
import { OrderedQueue, Throttle, type ThrottleStats } from './throttle';
import { mergeDeltas, type WidgetValue } from './value';

type GateImpl = Throttle<WidgetValue> | OrderedQueue<WidgetValue>;
const gates = new Map<string, { kind: Gate['kind']; gate: GateImpl }>();

/** Forgets a widget's gate and counters once the widget is gone. */
function dispose(widgetId: string) {
  gates.delete(widgetId);
  delete debugStore.throttle[widgetId];
}

async function sendNow(widgetId: string, value: WidgetValue) {
  // Look the widget up at send time so edits to its bindings apply immediately. Widgets can
  // live on any open desk; each desk's outputs are its own.
  const found = presetStore.findWidget(widgetId);
  if (!found) return dispose(widgetId);
  const { desk, widget } = found;
  // Wait for every message of this value before the gate releases, so none of them can be
  // overtaken by the next value's messages.
  const results = await Promise.allSettled(
    buildMessages(widget, value).map(({ outputIds, message }) =>
      osc.send(desk.id, outputIds, message, widgetId).catch((e: unknown) => {
        // Rust already logged encode errors; this catches IPC-level failures too.
        debugStore.local(`send ${message.address} failed: ${errorText(e)}`, widgetId);
        throw e;
      }),
    ),
  );
  const failed = results.find((r) => r.status === 'rejected');
  if (failed) throw failed.reason;
}

/** The widget's gate, recreated when its kind changes (e.g. a knob switched to endless). */
function gateImpl(widgetId: string, widget: Widget): GateImpl {
  const spec = gateFor(widget);
  let entry = gates.get(widgetId);
  if (!entry || entry.kind !== spec.kind) {
    const send = (v: WidgetValue) => sendNow(widgetId, v);
    const onStats = (stats: ThrottleStats) => {
      if (gates.has(widgetId)) debugStore.throttle[widgetId] = { ...stats };
    };
    const gate =
      spec.kind === 'queue'
        ? new OrderedQueue<WidgetValue>(send, onStats)
        : new Throttle<WidgetValue>(send, {
            maxHz: spec.maxHz,
            onStats,
            merge: spec.kind === 'merge' ? mergeDeltas : undefined,
          });
    entry = { kind: spec.kind, gate };
    gates.set(widgetId, entry);
  }
  if (spec.kind !== 'queue' && entry.gate instanceof Throttle) entry.gate.maxHz = spec.maxHz;
  return entry.gate;
}

/**
 * Records a widget's new value and sends it. `final` marks the end of a gesture (pointer up),
 * which bypasses the rate limit so the resting value always goes out promptly.
 */
export function emitValue(widgetId: string, value: WidgetValue, final = false) {
  const widget = presetStore.findWidget(widgetId)?.widget;
  if (!widget) return;
  values[widgetId] = value;
  const gate = gateImpl(widgetId, widget);
  gate.push(value);
  if (final) gate.flush();
}
