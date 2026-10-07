// Human-readable text for values, arguments and packets (Traffic view, previews, widget
// info). Pure; tested in format.test.ts.
import type { OscArg, OscPacketView } from '../ipc/types';
import { isList, isRecord, type Scalar, type ValueList, type WidgetValue } from './value';

/** A widget value, e.g. `x 0.5 · y 1` for a record. */
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

/**
 * A value as people read it on a display (the text widget): every number with exactly
 * `decimals` places (3.00, not 3), strings as written, lists joined by spaces, records as
 * `k v · k v`.
 */
export function displayValue(v: WidgetValue, decimals: number): string {
  const one = (x: Scalar | ValueList): string =>
    isList(x) ? x.map(one).join(' ') : typeof x === 'number' ? x.toFixed(decimals) : String(x);
  if (isRecord(v))
    return Object.entries(v)
      .map(([k, x]) => `${k} ${one(x)}`)
      .join(' · ');
  return one(v);
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

export interface HexLine {
  offset: string;
  hex: string;
  ascii: string;
}

/** Classic 16-bytes-per-line dump. OSC's 4-byte alignment is shown with a wider gap. */
export function hexDump(bytes: readonly number[], width = 16): HexLine[] {
  const lines: HexLine[] = [];
  for (let i = 0; i < bytes.length; i += width) {
    const chunk = bytes.slice(i, i + width);
    const hex = chunk
      .map((b, j) => b.toString(16).padStart(2, '0') + (j % 4 === 3 && j < width - 1 ? '  ' : ' '))
      .join('')
      .trimEnd();
    const ascii = chunk.map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '·')).join('');
    lines.push({ offset: i.toString(16).padStart(4, '0'), hex, ascii });
  }
  return lines;
}

/** HH:MM:SS.mmm local time, plus the microsecond remainder for precise inter-packet timing. */
export function formatTime(tsMicros: number): { clock: string; micros: string } {
  const d = new Date(Math.floor(tsMicros / 1000));
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return {
    clock: `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`,
    micros: p(tsMicros % 1000, 3),
  };
}

/** One-line summary: address, typetags and arguments (bundles summarised). */
export function summarize(packet: OscPacketView | null): string {
  if (!packet) return '';
  if (packet.kind === 'message') {
    return `${packet.address} ${packet.typetags} ${packet.args.map(formatArg).join(' ')}`.trimEnd();
  }
  const inner = packet.content.map(summarize);
  return `#bundle[${inner.length}] ${inner.join(' ; ')}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
