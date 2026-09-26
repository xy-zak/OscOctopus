// The session bus against the in-memory network: only valid messages reach handlers, and
// peers come and go in order with their messages.
import { describe, expect, it, vi } from 'vitest';
import type { SyncStatus } from '../ipc/types';
import { FakeNetwork } from './fake';

const ME = 'aaaaaaaaaaaaaaaa';
const PEER = 'bbbbbbbbbbbbbbbb';
const DOC = 'dddddddddddddddd';

const status: SyncStatus = {
  local: {
    peerId: ME,
    fingerprint: '',
    instanceId: '',
    profile: { name: 'me', color: 0 },
    identityError: null,
  },
  config: { port: 0, discovery: false, manualPeers: [] },
  session: null,
  listening: null,
  listenError: null,
  discoveryActive: false,
  discoveryError: null,
  peers: [],
  blocked: [],
};

vi.mock('../ipc/commands', () => ({
  sync: {
    status: async () => status,
    setProfile: async () => status,
    setConfig: async () => status,
    setBlocked: async () => status,
    remembered: async () => null,
  },
}));
vi.mock('../ipc/events', () => ({ onSyncStatus: async () => () => {} }));
vi.mock('../platform/settings', () => ({
  getSetting: async () => undefined,
  setSetting: async () => {},
}));

const { syncSession } = await import('./session.svelte');

describe('sync session bus', () => {
  it('validates messages and tracks peers', async () => {
    const net = new FakeNetwork();
    const me = net.add(ME);
    const other = net.add(PEER, 'Bob');
    syncSession.useTransport(me);
    await syncSession.start();
    await syncSession.bus.setDesks(['desk-1']);

    const ops: unknown[] = [];
    const changes: string[] = [];
    syncSession.bus.on('deskOps', (peer, desk, body) => ops.push([peer, desk, body.ops.length]));
    syncSession.bus.onPeers((c) => changes.push(c.type));

    net.connect(ME, PEER);
    await other.send(null, 'deskOps', 'desk-1', {
      doc: DOC,
      ops: [['name', [1, 0, PEER], 'Hi']],
    });
    await other.send(null, 'deskOps', 'desk-1', { doc: DOC, ops: 'garbage' });
    net.settle();

    expect(syncSession.peers[PEER]?.name).toBe('Bob');
    expect(ops).toEqual([[PEER, 'desk-1', 1]]);
    expect(syncSession.rejected[PEER]).toBe(1);

    net.disconnect(ME, PEER);
    expect(syncSession.peers[PEER]).toBeUndefined();
    expect(changes).toEqual(['up', 'down']);
  });
});
