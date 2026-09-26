// Widget value → OSC message. Pure functions; tested in mapping.test.ts.
//
// A widget's value is one of:
//   - a scalar: number | string | boolean                        (button, switch, fader, knob)
//   - a list of scalars                                          (future: fader banks, …)
//   - a record of named channels                                 (graph {x,y}, pads, list, …)
// Message arguments pick a channel (`ArgTemplate.channel`), addresses may contain `{channel}`
// placeholders, and argument types convert whatever they get.
import type { OscArg, OscMessage } from '../ipc/types';
import type { ArgTemplate, Channel, SliderProps, Widget } from '../model/preset';
import { clamp } from '../grid/engine';

const K = 4; // curvature of the exp/log fader curves

/** Shapes a normalised 0..1 fader position. `exp` gives finer control at the low end. */
export function shape(n: number, curve: SliderProps['curve']): number {
  n = clamp(n, 0, 1);
  switch (curve) {
    case 'exp':
      return (Math.exp(K * n) - 1) / (Math.exp(K) - 1);
    case 'log':
      return Math.log1p((Math.exp(K) - 1) * n) / K;
    default:
      return n;
  }
}

/** Inverse of `shape`. */
export function unshape(v: number, curve: SliderProps['curve']): number {
  v = clamp(v, 0, 1);
  switch (curve) {
    case 'exp':
      return Math.log1p((Math.exp(K) - 1) * v) / K;
    case 'log':
      return (Math.exp(K * v) - 1) / (Math.exp(K) - 1);
    default:
      return v;
  }
}

/** Fader position (0..1) → output value in [min, max], quantised to `step`. */
export function sliderValue(
  n: number,
  p: Pick<SliderProps, 'min' | 'max' | 'step' | 'curve'>,
): number {
  const raw = p.min + (p.max - p.min) * shape(n, p.curve);
  if (p.step <= 0) return raw;
  const q = p.min + Math.round((raw - p.min) / p.step) * p.step;
  const lo = Math.min(p.min, p.max);
  const hi = Math.max(p.min, p.max);
  // Round away float noise from the step arithmetic (0.1 + 0.2 ...).
  return clamp(Number(q.toFixed(10)), lo, hi);
}

/** Output value → fader position (0..1). */
export function sliderPosition(v: number, p: Pick<SliderProps, 'min' | 'max' | 'curve'>): number {
  if (p.max === p.min) return 0;
  return unshape((v - p.min) / (p.max - p.min), p.curve);
}

// ---- value model ---------------------------------------------------------------------------

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

function toNumber(v: Scalar | ValueList | undefined): number {
  if (isList(v)) return toNumber(v[0]);
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toBool(v: Scalar | ValueList | undefined): boolean {
  if (isList(v)) return v.length > 0;
  if (typeof v === 'string') return v !== '' && v !== '0' && v.toLowerCase() !== 'false';
  return !!v;
}

function toText(v: Scalar | ValueList | undefined): string {
  if (v === undefined) return '';
  if (isList(v)) return v.map(toText).join(' ');
  if (typeof v === 'number') return String(Number(v.toFixed(6)));
  return String(v);
}

function toInt(v: number): number {
  return Math.round(clamp(v, -2147483648, 2147483647));
}

/** A scalar as the most natural OSC argument. */
function autoArg(v: Scalar): OscArg {
  if (typeof v === 'boolean') return v ? { type: 'T' } : { type: 'F' };
  if (typeof v === 'string') return { type: 's', value: v };
  return { type: 'f', value: v };
}

/** Note event → OSC MIDI [port, status, data1, data2]. Anything else → Nil. */
function midiArg(v: WidgetValue): OscArg {
  if (!isRecord(v) || typeof v.note !== 'number') return { type: 'N' };
  const channel = clamp(Math.round(toNumber(v.channel ?? 1)), 1, 16) - 1;
  const on = v.on === undefined ? true : toBool(v.on);
  const vel = clamp(Math.round(toNumber(v.velocity ?? 1) * 127), 0, 127);
  return {
    type: 'm',
    value: [0, (on ? 0x90 : 0x80) | channel, clamp(Math.round(v.note), 0, 127), on ? vel : 0],
  };
}

/** One argument template → its OSC argument(s). Only `...` can produce more than one. */
export function buildArgs(t: ArgTemplate, widgetValue: WidgetValue): OscArg[] {
  if (t.kind === 'const') return [constArg(t)];
  if (t.type === 'm') return [midiArg(widgetValue)];
  const v = channelValue(widgetValue, t.channel);
  switch (t.type) {
    case 'f':
      return [{ type: 'f', value: toNumber(v) }];
    case 'd':
      return [{ type: 'd', value: toNumber(v) }];
    case 'i':
      return [{ type: 'i', value: toInt(toNumber(v)) }];
    case 'h':
      return [{ type: 'h', value: Math.round(toNumber(v)) }];
    case 'TF':
      return [toBool(v) ? { type: 'T' } : { type: 'F' }];
    case 's':
      return [{ type: 's', value: toText(v) }];
    case 'auto':
      if (v === undefined) return [{ type: 'N' }];
      return [isList(v) ? { type: '[', value: v.map(autoArg) } : autoArg(v)];
    case '[]':
      return [{ type: '[', value: (isList(v) ? v : v === undefined ? [] : [v]).map(autoArg) }];
    case '...':
      return (isList(v) ? v : v === undefined ? [] : [v]).map(autoArg);
  }
}

/** Single-argument convenience (everything except `...` spreads). */
export function buildArg(t: ArgTemplate, value: WidgetValue): OscArg {
  return buildArgs(t, value)[0] ?? { type: 'N' };
}

function constArg(t: Extract<ArgTemplate, { kind: 'const' }>): OscArg {
  const num = Number(t.value);
  const safe = Number.isFinite(num) ? num : 0;
  switch (t.type) {
    case 'f':
    case 'd':
      return { type: t.type, value: safe };
    case 'i':
      return { type: 'i', value: toInt(safe) };
    case 'h':
      return { type: 'h', value: Math.round(safe) };
    case 's':
      return { type: 's', value: t.value };
    default:
      return { type: t.type };
  }
}

/**
 * Fills `{channel}` placeholders from the value, e.g. `/grid/{row}/{col}`. Unknown channels
 * are left as written so the preview shows exactly what would go out.
 */
export function fillAddress(address: string, value: WidgetValue): string {
  return address.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, ch: string) => {
    const v = channelValue(value, ch);
    if (v === undefined || (isRecord(value) && !(ch in value))) return whole;
    return toText(v).replace(/\s+/g, '_');
  });
}

/** The value a widget has before anyone touches it. */
export function initialValue(w: Widget): WidgetValue {
  switch (w.type) {
    case 'slider':
      return w.props.defaultValue;
    case 'knob':
      return w.props.mode === 'endless'
        ? { value: w.props.defaultValue, delta: 0 }
        : w.props.defaultValue;
    case 'graph':
      return { x: w.props.x.defaultValue, y: w.props.y.defaultValue };
    case 'pads':
      return padEvent(w.props, 1, 1, false);
    case 'list': {
      const i = clamp(w.props.defaultIndex, 0, w.props.options.length - 1);
      return listValue(w.props.options, i);
    }
    default:
      return w.props.offValue;
  }
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

export function formatValue(v: WidgetValue): string {
  const one = (x: Scalar | ValueList): string =>
    isList(x)
      ? `[${x.map(one).join(' ')}]`
      : typeof x === 'number'
        ? String(Number(x.toFixed(4)))
        : typeof x === 'string'
          ? JSON.stringify(x)
          : String(x);
  if (isRecord(v))
    return Object.entries(v)
      .map(([k, x]) => `${k} ${one(x)}`)
      .join(' · ');
  return one(v);
}

export interface Outgoing {
  bindingId: string;
  outputIds: string[];
  message: OscMessage;
}

/**
 * Every message a widget sends for `value`. Disabled or output-less bindings are skipped.
 * All bindings are sent on every change (for the graph, moving only X still resends Y) so a
 * receiver that missed a packet resynchronises on the next one.
 */
export function buildMessages(widget: Widget, value: WidgetValue): Outgoing[] {
  return widget.bindings
    .filter((b) => b.enabled && b.outputIds.length > 0)
    .map((b) => ({
      bindingId: b.id,
      outputIds: [...b.outputIds],
      message: {
        address: fillAddress(b.address, value),
        args: b.args.flatMap((a) => buildArgs(a, value)),
      },
    }));
}

/** The typetag string a message will carry, e.g. ",fi". Mirrors OscArg::typetag in Rust. */
export function typetags(args: OscArg[]): string {
  const tag = (a: OscArg): string => (a.type === '[' ? `[${a.value.map(tag).join('')}]` : a.type);
  return ',' + args.map(tag).join('');
}

export function formatArg(a: OscArg): string {
  switch (a.type) {
    case 'f':
    case 'd':
      return Number.isInteger(a.value)
        ? a.value.toFixed(1)
        : String(Number(a.value.toPrecision(7)));
    case 's':
      return JSON.stringify(a.value);
    case 'c':
      return `'${a.value}'`;
    case 'b':
      return `<blob ${a.value.length}B>`;
    case 'r':
      return '#' + a.value.toString(16).padStart(8, '0');
    case 'm':
      return `midi(${a.value.map((b) => b.toString(16).padStart(2, '0')).join(' ')})`;
    case 't':
      return `time(${a.value.seconds}.${a.value.fractional})`;
    case '[':
      return `[${a.value.map(formatArg).join(' ')}]`;
    case 'i':
    case 'h':
      return String(a.value);
    default:
      return a.type;
  }
}

/** Mirrors `validate_address` in src-tauri/src/osc/codec.rs so the editor can flag errors early. */
export function addressError(address: string): string | null {
  if (!address.startsWith('/')) return "must start with '/'";
  for (const c of address) {
    const code = c.codePointAt(0)!;
    if (code < 0x21 || code > 0x7e) return 'only printable ASCII without spaces is allowed';
    if (c === '#' || c === ',') return "'#' and ',' are reserved";
  }
  return null;
}
