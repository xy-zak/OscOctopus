// Connects widget interaction to the wire: value → gate → messages → osc_send.
//
// Two kinds of gate, chosen by widget type:
//   - continuous widgets (fader, graph, knob) go through a rate-limited Throttle: under a
//     fast drag only the newest value matters, and the resting value always goes out.
//   - discrete widgets (button, switch, pads, list) go through an OrderedQueue: every press,
//     pad hit or selection is sent, in order, never merged away.
// The endless knob is continuous but its deltas must add up, so its throttle *merges*
// held-back values (+1 +1 +1 → +3) instead of replacing them.
import { osc } from '../ipc/commands';
import type { Widget } from '../model/preset';
import { debugStore } from '../state/debug.svelte';
import { presetStore } from '../state/preset.svelte';
import { errorText } from '../state/ui.svelte';
import { values } from '../state/values.svelte';
import { buildMessages, mergeDeltas, type WidgetValue } from './mapping';
import { OrderedQueue, Throttle, type ThrottleStats } from './throttle';

type Gate = Throttle<WidgetValue> | OrderedQueue<WidgetValue>;
const gates = new Map<string, Gate>();

async function sendNow(widgetId: string, value: WidgetValue) {
  // Look the widget up at send time so edits to its bindings apply immediately. Widgets can
  // live on any open desk; each desk's outputs are its own.
  const found = presetStore.findWidget(widgetId);
  if (!found) return;
  const { desk, widget } = found;
  await Promise.all(
    buildMessages(widget, value).map(({ outputIds, message }) =>
      osc.send(desk.id, outputIds, message, widgetId).catch((e) => {
        // Rust already logged encode errors; this catches IPC-level failures too.
        debugStore.local(`send ${message.address} failed: ${errorText(e)}`, widgetId);
        throw e;
      }),
    ),
  );
}

/** Continuous widgets' rate limit (messages per second), or undefined for discrete ones. */
export function continuousRate(w: Widget | undefined): number | undefined {
  if (w?.type === 'slider' || w?.type === 'graph' || w?.type === 'knob') return w.props.maxRateHz;
  return undefined;
}

function gateFor(widgetId: string, widget: Widget | undefined): Gate {
  const rate = continuousRate(widget);
  const endless = widget?.type === 'knob' && widget.props.mode === 'endless';
  let gate = gates.get(widgetId);
  const wantThrottle = rate !== undefined;
  // Recreate if the widget's kind changed (e.g. a knob switched to endless).
  const kind = wantThrottle ? (endless ? 'merge' : 'throttle') : 'queue';
  if (!gate || (gate as Gate & { kind?: string }).kind !== kind) {
    const onStats = (stats: ThrottleStats) => (debugStore.throttle[widgetId] = { ...stats });
    gate = wantThrottle
      ? new Throttle<WidgetValue>(
          (v) => sendNow(widgetId, v),
          rate,
          undefined,
          onStats,
          endless ? mergeDeltas : undefined,
        )
      : new OrderedQueue<WidgetValue>((v) => sendNow(widgetId, v), onStats);
    (gate as Gate & { kind?: string }).kind = kind;
    gates.set(widgetId, gate);
  }
  if (gate instanceof Throttle && rate !== undefined) gate.maxHz = rate;
  return gate;
}

/**
 * Records a widget's new value and sends it. `final` marks the end of a gesture (pointer up),
 * which bypasses the rate limit so the resting value always goes out promptly.
 */
export function emitValue(widgetId: string, value: WidgetValue, final = false) {
  values[widgetId] = value;
  const gate = gateFor(widgetId, presetStore.findWidget(widgetId)?.widget);
  gate.push(value);
  if (final) gate.flush();
}
