// The one place that decides what a local value change does, by where it came from:
//
//   origin   show it   send OSC to outputs                    tell sync peers
//   touch    yes       yes (PAUSE holds it in Rust)            yes (sync skips it while PAUSED)
//   input    yes       only when forwarded, never back to      yes
//                      where it came from (osc/receiver)
//
// Changes from sync peers (and desk-open snapshots) never come through here: sync shows them
// with state/live.ts, which cannot send. sync/** may not import this module or the sender,
// so "a peer's change never sends OSC" holds by construction (sync/boundary.test.ts).
import type { Avoid } from '../ipc/types';
import type { Widget } from '../model/preset';
import { localValues } from '../state/changes';
import { show } from '../state/live';
import { presetStore } from '../state/preset.svelte';
import { pulse } from '../state/touch';
import { touchKeyOf } from '../widgets/defs';
import { sendValue } from './sender';
import type { WidgetValue } from './value';

/**
 * A local gesture or key press changed a widget: show it, send it, share it. `final` marks the
 * end of a gesture, which bypasses the rate limit so the resting value goes out promptly.
 */
export function emitValue(widgetId: string, value: WidgetValue, final = false) {
  const found = presetStore.findWidget(widgetId);
  if (!found) return;
  const { desk, widget } = found;
  pulse(touchKeyOf(widget, value));
  show(widget, value, 'touch');
  sendValue(widget, value, final);
  localValues.emit({ deskId: desk.id, widgetId, value, origin: 'touch', final });
}

/**
 * Matched OSC input changed a widget: show it and share it. It is sent to outputs only when
 * `forward` is given (the binding forwards and it's allowed; see receiver.ts), and then never
 * back to where it came from.
 */
export function applyInput(
  deskId: string,
  widget: Widget,
  value: WidgetValue,
  forward: Avoid | null,
) {
  show(widget, value, 'input');
  if (forward) sendValue(widget, value, true, forward);
  localValues.emit({ deskId, widgetId: widget.id, value, origin: 'input', final: true });
}
