// What a widget type has to provide. Each type lives in its own folder (`widgets/<type>/`):
//   def.ts               its behaviour, a `WidgetDef` (pure: no Svelte, unit-testable)
//   <Type>.svelte        the widget itself, taking `{ widget, live }`
//   <Type>Inspector.svelte  the editor for its props, taking `{ widget = $bindable(), onchange }`
// defs.ts and registry.ts collect them in maps typed over every `WidgetType`, so a missing
// piece is a compile error rather than a silent default.
import type { Widget, WidgetType } from '../model/preset';
import type { WidgetValue } from '../osc/value';

export type WidgetOf<T extends WidgetType> = Extract<Widget, { type: T }>;

/** The fields every widget shares, as handed to `WidgetDef.create`. */
export type WidgetBase = Pick<Widget, 'id' | 'x' | 'y' | 'w' | 'h' | 'color'>;

/** A named part of a widget's value that message arguments and `{placeholders}` can pick. */
export interface ChannelInfo {
  id: string;
  hint: string;
}

/**
 * How a widget's values reach the wire (see osc/sender.ts):
 * - queue: discrete events (presses, hits, selections). Every value is sent, in order.
 * - throttle: continuous values. At most `maxHz` per second; the newest value wins and the
 *   resting value always goes out.
 * - merge: like throttle, but held-back values are merged (an encoder's +1 +1 +1 → +3).
 */
export type Gate =
  { kind: 'queue' } | { kind: 'throttle'; maxHz: number } | { kind: 'merge'; maxHz: number };

export interface WidgetDef<W extends Widget> {
  /** Shown in the toolbar and the Inspector. */
  label: string;
  /** Size of a newly added widget, in grid cells. */
  defaultSize: { w: number; h: number };
  /** A new widget with default props and messages; `n` numbers it among its type. */
  create(base: WidgetBase, n: number, outputIds: string[]): W;
  /** The value before anyone touches it. */
  initialValue(w: W): WidgetValue;
  /** Named channels of the value; [] = a single value (no channel choice). */
  channels(w: W): ChannelInfo[];
  gate(w: W): Gate;
}
