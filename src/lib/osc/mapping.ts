// Widget value → OSC messages. Pure functions; tested in mapping.test.ts and values.test.ts.
//
// Each binding of a widget becomes one message: its address (with `{channel}` placeholders
// filled from the value) and its argument templates, each converted from (a channel of) the
// value to the template's OSC type.
import type { OscArg, OscMessage } from '../ipc/types';
import type { ArgTemplate, Widget } from '../model/preset';
import { clamp } from '../util';
import {
  channelValue,
  isList,
  isRecord,
  type Scalar,
  type ValueList,
  type WidgetValue,
} from './value';

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

/**
 * A note event (`NoteEvent` in value.ts; only `note` is required, the rest default) → OSC MIDI
 * [port, status, data1, data2]. Anything else → Nil.
 */
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

export interface Outgoing {
  bindingId: string;
  outputIds: string[];
  message: OscMessage;
}

/**
 * Every message a widget sends for `value`. Bindings that don't send, or have no output, are skipped.
 * All bindings are sent on every change (for the graph, moving only X still resends Y) so a
 * receiver that missed a packet resynchronises on the next one.
 */
export function buildMessages(widget: Widget, value: WidgetValue): Outgoing[] {
  return widget.bindings
    .filter((b) => b.send && b.outputIds.length > 0)
    .map((b) => ({
      bindingId: b.id,
      outputIds: [...b.outputIds],
      message: {
        address: fillAddress(b.address, value),
        args: b.args.flatMap((a) => buildArgs(a, value)),
      },
    }));
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
