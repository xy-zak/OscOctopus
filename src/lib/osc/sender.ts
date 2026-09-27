// The wire side of a widget: value → gate → messages → osc_send. Only osc/flow.ts calls it;
// flow decides *whether* a change is sent (see the origin rules there).
//
// Each widget's def says how its values travel (`Gate` in widgets/types.ts):
//   - queue: discrete events (button, switch, pads, list) go through an OrderedQueue: every
//     press, hit or selection is sent, in order, never merged away.
//   - throttle: continuous values (fader, graph) go through a rate-limited Throttle: under a
//     fast drag only the newest value matters, and the resting value always goes out.
import { osc } from '../ipc/commands';
import type { Avoid } from '../ipc/types';
import type { Widget } from '../model/preset';
import { debugStore } from '../state/debug.svelte';
import { presetStore } from '../state/preset.svelte';
import { errorText } from '../util';
import { gateFor } from '../widgets/defs';
import type { Gate } from '../widgets/types';
import { expectations } from './expect';
import { buildMessages } from './mapping';
import { OrderedQueue, Throttle, type ThrottleStats } from './throttle';
import type { WidgetValue } from './value';

/** One value on its way out. `avoid` (forwarded input only) keeps it from its sender. */
interface Outgoing {
  value: WidgetValue;
  avoid?: Avoid;
}

type GateImpl = Throttle<Outgoing> | OrderedQueue<Outgoing>;
const gates = new Map<string, { kind: Gate['kind']; gate: GateImpl }>();

/** Forgets a widget's gate and counters once the widget is gone. */
function dispose(widgetId: string) {
  gates.delete(widgetId);
  delete debugStore.throttle[widgetId];
}

async function sendNow(widgetId: string, { value, avoid }: Outgoing) {
  // Look the widget up at send time so edits to its bindings apply immediately. Widgets can
  // live on any open desk; each desk's outputs are its own.
  const found = presetStore.findWidget(widgetId);
  if (!found) return dispose(widgetId);
  const { desk, widget } = found;
  // Only values that really go out are remembered: a device echoing them back is recognised.
  expectations.note(widget, value);
  // Wait for every message of this value before the gate releases, so none of them can be
  // overtaken by the next value's messages.
  const results = await Promise.allSettled(
    buildMessages(widget, value).map(({ outputIds, message }) =>
      osc.send(desk.id, outputIds, message, widgetId, avoid).catch((e: unknown) => {
        // Rust already logged encode errors; this catches IPC-level failures too.
        debugStore.local(`send ${message.address} failed: ${errorText(e)}`, widgetId);
        throw e;
      }),
    ),
  );
  const failed = results.find((r) => r.status === 'rejected');
  if (failed) throw failed.reason;
}

/** The widget's gate, recreated when its kind changes. */
function gateImpl(widgetId: string, widget: Widget): GateImpl {
  const spec = gateFor(widget);
  let entry = gates.get(widgetId);
  if (!entry || entry.kind !== spec.kind) {
    const send = (item: Outgoing) => sendNow(widgetId, item);
    const onStats = (stats: ThrottleStats) => {
      if (gates.has(widgetId)) debugStore.throttle[widgetId] = { ...stats };
    };
    const gate =
      spec.kind === 'queue'
        ? new OrderedQueue<Outgoing>(send, onStats)
        : new Throttle<Outgoing>(send, { maxHz: spec.maxHz, onStats });
    entry = { kind: spec.kind, gate };
    gates.set(widgetId, entry);
  }
  if (spec.kind === 'throttle' && entry.gate instanceof Throttle) entry.gate.maxHz = spec.maxHz;
  return entry.gate;
}

/**
 * Sends a widget's value through its gate. `final` marks the end of a gesture (pointer up),
 * which bypasses the rate limit so the resting value always goes out promptly.
 */
export function sendValue(widget: Widget, value: WidgetValue, final: boolean, avoid?: Avoid) {
  const gate = gateImpl(widget.id, widget);
  gate.push({ value, avoid });
  if (final) gate.flush();
}
