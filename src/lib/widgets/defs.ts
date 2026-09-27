// Every widget type's behaviour (see types.ts). Pure: stores, the sender and tests use this
// without pulling in any Svelte component (those are in registry.ts).
import type { Rect } from '../grid/engine';
import { uid } from '../model/parts';
import type { Widget, WidgetType } from '../model/preset';
import type { WidgetValue } from '../osc/value';
import { buttonDef } from './button/def';
import { graphDef } from './graph/def';
import { listDef } from './list/def';
import { padsDef } from './pads/def';
import { sliderDef } from './slider/def';
import { switchDef } from './switch/def';
import type { ChannelInfo, Gate, InputPatch, WidgetDef, WidgetOf } from './types';

/** In toolbar order. Typed over every WidgetType: a type without a def does not compile. */
export const DEFS: { [T in WidgetType]: WidgetDef<WidgetOf<T>> } = {
  button: buttonDef,
  switch: switchDef,
  slider: sliderDef,
  graph: graphDef,
  pads: padsDef,
  list: listDef,
};

export const WIDGET_TYPES = Object.keys(DEFS) as WidgetType[];

/**
 * The def of a widget. `DEFS[w.type]` is the def for exactly `w`'s type, but TypeScript can't
 * correlate the two through a union, so this is the one place that says so.
 */
export function defOf<W extends Widget>(w: W): WidgetDef<W> {
  return DEFS[w.type] as unknown as WidgetDef<W>;
}

/** A new widget of `type` at `rect`, sending to `outputIds`; `n` numbers it among its type. */
export function newWidget<T extends WidgetType>(
  type: T,
  rect: Rect,
  outputIds: string[],
  n = 1,
): WidgetOf<T> {
  const def: WidgetDef<WidgetOf<T>> = DEFS[type];
  return def.create({ id: uid('w'), ...rect, color: null }, n, outputIds);
}

export const initialValue = (w: Widget): WidgetValue => defOf(w).initialValue(w);
export const channelsFor = (w: Widget): ChannelInfo[] => defOf(w).channels(w);
export const gateFor = (w: Widget): Gate => defOf(w).gate(w);
export const inputValue = (w: Widget, patch: InputPatch, current: WidgetValue) =>
  defOf(w).input(w, patch, current);
export const echoToleranceOf = (w: Widget) => defOf(w).echoTolerance(w);
export const isValueFor = (w: Widget, value: unknown): value is WidgetValue =>
  defOf(w).isValue(w, value);
export const touchKeyOf = (w: Widget, value: WidgetValue) => defOf(w).touchKey?.(w, value) ?? w.id;

/**
 * The channel a template without one refers to, mirroring `channelValue`: `value` if the
 * widget's value has it, otherwise its first channel; `value` for single-value widgets.
 */
export function defaultChannel(w: Widget): string {
  const ids = channelsFor(w).map((c) => c.id);
  return ids.length === 0 || ids.includes('value') ? 'value' : ids[0]!;
}
