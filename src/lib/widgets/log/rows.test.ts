import { describe, expect, it } from 'vitest';
import type { DebugEvent } from '../../ipc/types';
import type { Received } from '../../state/input.svelte';
import { newestRows, receivedRow, sentRow } from './rows';

function event(over: Partial<DebugEvent>): DebugEvent {
  return {
    seq: 1,
    tsMicros: 1_000,
    kind: 'packet',
    direction: 'out',
    desk: 'd',
    endpointId: 'out-1',
    endpointName: 'Lights',
    transport: 'udp',
    local: null,
    remote: '192.0.2.5:9000',
    bytes: [1, 2, 3, 4],
    wireLen: 16,
    decoded: {
      kind: 'message',
      address: '/cue',
      typetags: ',if',
      args: [
        { type: 'i', value: 3 },
        { type: 'f', value: 0.5 },
      ],
    },
    decodeError: null,
    error: null,
    message: null,
    source: 'w-1',
    blocked: false,
    origin: null,
    ...over,
  };
}

const received = (over: Partial<Received>): Received => ({
  id: 7,
  widgetId: 'w-2',
  result: 'applied',
  msg: {
    seq: 9,
    tsMicros: 2_000,
    desk: 'd',
    endpointId: 'in-1',
    remote: '192.0.2.9:8000',
    address: '/fader',
    args: [{ type: 's', value: 'up' }],
  },
  ...over,
});

describe('log rows', () => {
  it('shows a sent packet: where it went, how big, and whether it was held or failed', () => {
    expect(sentRow(event({}), 'w-1')).toMatchObject({
      dir: 'out',
      widgetId: 'w-1',
      address: '/cue',
      value: '3 0.5',
      endpoint: 'Lights',
      ip: '192.0.2.5:9000',
      result: 'sent',
      size: '16 B',
      error: false,
      blocked: false,
    });
    expect(sentRow(event({ blocked: true, remote: null }), 'w-1')).toMatchObject({
      result: 'held',
      blocked: true,
      ip: '',
    });
    expect(sentRow(event({ error: 'host unreachable' }), 'w-1')).toMatchObject({
      result: 'host unreachable',
      error: true,
    });
  });

  it('shows a note about a widget (a sequence ending) with its text', () => {
    const note = event({ kind: 'info', direction: null, decoded: null, message: 'finished' });
    expect(sentRow(note, 'w-1')).toMatchObject({ dir: 'note', value: 'finished', size: '' });
  });

  it('shows a received message: where from, and what input mapping did', () => {
    expect(receivedRow(received({}), 'Desk in')).toMatchObject({
      key: 'i7',
      dir: 'in',
      address: '/fader',
      value: '"up"',
      endpoint: 'Desk in',
      ip: '192.0.2.9:8000',
      result: 'applied',
    });
  });

  it('keeps the newest, newest first', () => {
    const rows = [
      sentRow(event({ seq: 1, tsMicros: 10 }), 'w-1'),
      receivedRow(received({ id: 1, msg: { ...received({}).msg, tsMicros: 30 } }), ''),
      sentRow(event({ seq: 2, tsMicros: 20 }), 'w-1'),
    ];
    expect(newestRows(rows, 2).map((r) => r.tsMicros)).toEqual([30, 20]);
  });
});
