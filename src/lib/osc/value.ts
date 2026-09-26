// The value model: what a widget's live value can be, and how to pick parts of it. Pure;
// tested in values.test.ts.
//
// A widget's value is one of:
//   - a scalar: number | string | boolean                        (button, switch, fader, knob)
//   - a list of scalars                                          (future: fader banks, …)
//   - a record of named channels                                 (graph {x,y}, pads, list, …)
// Message arguments pick a channel (`ArgTemplate.channel`), and addresses may contain
// `{channel}` placeholders (see mapping.ts).
import type { Channel } from '../model/preset';

export type Scalar = number | string | boolean;
export type ValueList = Scalar[];
export type ValueRecord = { [channel: string]: Scalar | ValueList };
export type WidgetValue = Scalar | ValueList | ValueRecord;

/** The graph's value. */
export interface XY extends ValueRecord {
  x: number;
  y: number;
}

/** A note event (for future widgets such as a keyboard). The `m` (MIDI) argument type takes it. */
export interface NoteEvent extends ValueRecord {
  note: number;
  /** 0..1 */
  velocity: number;
  /** MIDI channel 1–16. */
  channel: number;
  on: boolean;
}

export const isList = (v: unknown): v is ValueList => Array.isArray(v);
export const isRecord = (v: unknown): v is ValueRecord =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The part of a value an argument (or address placeholder) refers to. For records: the named
 * channel, or with no channel `value` if present, else the first channel (the graph's x). For
 * lists: a numeric channel is an index, otherwise the whole list. Scalars ignore the channel.
 */
export function channelValue(
  value: WidgetValue,
  channel: Channel | undefined,
): Scalar | ValueList | undefined {
  if (isRecord(value)) {
    if (channel) return value[channel];
    return 'value' in value ? value.value : Object.values(value)[0];
  }
  if (isList(value)) {
    if (channel !== undefined && /^\d+$/.test(channel)) return value[Number(channel)];
    return value;
  }
  return value;
}

/** A pad hit. Pads are numbered 1…rows×cols in reading order; row and col count from 1. */
export function padEvent(
  p: { cols: number },
  row: number,
  col: number,
  on: boolean,
): ValueRecord & { number: number; row: number; col: number; on: boolean } {
  return { number: (row - 1) * p.cols + col, row, col, on };
}

/** A list selection: index, label and value (numeric-looking values become numbers). */
export function listValue(
  options: readonly { label: string; value: string }[],
  index: number,
): ValueRecord {
  const o = options[index] ?? { label: '', value: '' };
  const n = Number(o.value);
  return {
    index,
    label: o.label,
    value: o.value.trim() !== '' && Number.isFinite(n) ? n : o.value,
  };
}

/** Endless-encoder merge: keep the newest absolute value, add up the deltas. */
export function mergeDeltas(held: WidgetValue, next: WidgetValue): WidgetValue {
  if (
    isRecord(held) &&
    isRecord(next) &&
    typeof held.delta === 'number' &&
    typeof next.delta === 'number'
  ) {
    return { ...next, delta: Number((held.delta + next.delta).toFixed(10)) };
  }
  return next;
}
