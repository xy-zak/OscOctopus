// Formatting for the debug view. Pure; tested in format.test.ts.
import type { OscPacketView } from '../ipc/types';
import { formatArg } from './mapping';

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

export function hexString(bytes: readonly number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');
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
