// Writes a value to what the desk shows: the live value, plus the visual feedback its widget
// type derives from it (pads lighting, trigger flashes). It never sends anything, so every
// origin can use it, sync peers included (osc/flow.ts decides what else a change does).
import type { Widget } from '../model/preset';
import type { WidgetValue } from '../osc/value';
import { defOf } from '../widgets/defs';
import type { ValueOrigin } from '../widgets/types';
import { flashPad, flashWidget, setPadLit } from './feedback.svelte';
import { values } from './values.svelte';

export function show(widget: Widget, value: WidgetValue, origin: ValueOrigin) {
  values[widget.id] = value;
  defOf(widget).show?.(widget, value, {
    origin,
    setPadLit: (pad, on) => setPadLit(widget.id, pad, on),
    flashPad: (pad) => flashPad(widget.id, pad),
    flash: () => flashWidget(widget.id),
  });
}
