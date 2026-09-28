// The rows of a log widget: what the widgets it follows sent (debug events, by their source)
// and received (input mapping's rows, by widget), newest first. Pure; tested in rows.test.ts.
import type { DebugEvent } from '../../ipc/types';
import type { LogColumn } from '../../model/preset';
import { formatArg } from '../../osc/format';
import type { Received } from '../../state/input.svelte';

export interface LogRow {
  key: string;
  tsMicros: number;
  /** A message sent or received, or a note about the widget (an error, a sequence ending). */
  dir: 'out' | 'in' | 'note';
  widgetId: string;
  address: string;
  /** The message's arguments, or a note's text. */
  value: string;
  endpoint: string;
  /** Where a message went, or came from. */
  ip: string;
  result: string;
  size: string;
  error: boolean;
  /** Held back by OSC-OUT off. */
  blocked: boolean;
}

/** One debug event a widget caused: a packet it sent (one per output), or a note. */
export function sentRow(e: DebugEvent, widgetId: string): LogRow {
  const packet = e.kind === 'packet';
  const msg = e.decoded?.kind === 'message' ? e.decoded : null;
  return {
    key: `o${e.seq}.${e.tsMicros}`,
    tsMicros: e.tsMicros,
    dir: packet ? 'out' : 'note',
    widgetId,
    address: msg?.address ?? '',
    value: msg ? msg.args.map(formatArg).join(' ') : (e.message ?? e.error ?? ''),
    endpoint: e.endpointName || e.endpointId,
    ip: e.remote ?? '',
    result: e.error ?? (e.blocked ? 'held' : packet ? 'sent' : ''),
    size: packet ? `${e.wireLen ?? e.bytes.length} B` : '',
    error: e.error !== null,
    blocked: e.blocked,
  };
}

/** One message a widget received, and what input mapping did with it. */
export function receivedRow(r: Received, endpoint: string): LogRow {
  return {
    key: `i${r.id}`,
    tsMicros: r.msg.tsMicros,
    dir: 'in',
    widgetId: r.widgetId,
    address: r.msg.address,
    value: r.msg.args.map(formatArg).join(' '),
    endpoint,
    ip: r.msg.remote,
    result: r.result,
    size: '',
    error: false,
    blocked: false,
  };
}

/** The newest `limit` rows, newest first. */
export function newestRows(rows: readonly LogRow[], limit: number): LogRow[] {
  return [...rows].sort((a, b) => b.tsMicros - a.tsMicros).slice(0, limit);
}

/** Each column's heading and width, in LOG_COLUMNS order. */
export const COLUMNS: Record<LogColumn, { label: string; width: string }> = {
  time: { label: 'TIME', width: '12ch' },
  dir: { label: '', width: '1ch' },
  widget: { label: 'WIDGET', width: 'minmax(6ch, 12ch)' },
  address: { label: 'ADDRESS', width: 'minmax(8ch, 1fr)' },
  value: { label: 'VALUE', width: 'minmax(6ch, 1fr)' },
  endpoint: { label: 'WHERE', width: 'minmax(6ch, 12ch)' },
  ip: { label: 'IP', width: 'minmax(8ch, 21ch)' },
  result: { label: 'RESULT', width: 'minmax(6ch, 10ch)' },
  size: { label: 'SIZE', width: '6ch' },
};
