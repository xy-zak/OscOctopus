// What a widget type has to provide. Each type lives in its own folder (`widgets/<type>/`):
//   def.ts               its behaviour, a `WidgetDef` (pure: no Svelte, unit-testable)
//   <Type>.svelte        the widget itself, taking `{ widget, live }`
//   <Type>Inspector.svelte  the editor for its props, taking `{ widget = $bindable(), onchange }`
// defs.ts and registry.ts collect them in maps typed over every `WidgetType`, so a missing
// piece is a compile error rather than a silent default.
import type { Widget, WidgetType } from '../model/preset';
import type { Scalar, ValueList, WidgetValue } from '../osc/value';

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

/**
 * What a received OSC message says about a widget's value, by channel. Single-value widgets
 * use the key `value`. Only the channels the message carried are present.
 */
export type InputPatch = Record<string, Scalar | ValueList>;

/** Where a shown value came from (see osc/flow.ts for what each origin may do). */
export type ValueOrigin = 'touch' | 'input' | 'peer' | 'init';

/** What `show` may do besides setting the value (see state/feedback.svelte.ts). */
export interface FeedbackApi {
  origin: ValueOrigin;
  setPadLit(pad: number, on: boolean): void;
  flashPad(pad: number): void;
  flash(): void;
}

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
  /**
   * The value a received message sets, given the current one, or null to ignore it. It must
   * be idempotent: it *sets* state (a toggle pad is set on or off, never flipped). The one
   * exception is a bare `delta` on an endless knob, which adds.
   */
  input(w: W, patch: InputPatch, current: WidgetValue): WidgetValue | null;
  /**
   * The channels compared to recognise our own sent values coming back (see osc/expect.ts),
   * each with the numeric tolerance allowed. Single-value widgets use the key `value`.
   */
  echoTolerance(w: W): Record<string, number>;
  /**
   * Whether a value from a sync peer is one this widget can hold: the right shape, in range.
   * A peer's value that isn't is ignored (it is never coerced: peers run the same code).
   */
  isValue(w: W, value: unknown): value is WidgetValue;
  /**
   * Visual feedback a shown value implies beyond the value itself (pads, trigger flashes).
   * Flashes are for events happening now (`input`, `peer`), never for a snapshot (`init`).
   */
  show?(w: W, value: WidgetValue, fx: FeedbackApi): void;
  /** The touch key a value belongs to, when finer than the widget (one pad of a grid). */
  touchKey?(w: W, value: WidgetValue): string;
}
