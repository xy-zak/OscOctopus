import { describe, expect, it } from 'vitest';
import type { SyncEvent } from '../ipc/types';
import { FakeNetwork } from './fake';

function node(net: FakeNetwork, id: string) {
  const t = net.add(id);
  const got: SyncEvent[] = [];
  void t.listen((events) => got.push(...events));
  return { t, got };
}

const bodies = (events: SyncEvent[]) =>
  events.flatMap((e) => (e.type === 'message' ? [e.body] : []));

/** A seeded pseudo-random source, so a failure can be replayed. */
function seeded(seed: number) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

describe('fake sync network', () => {
  it('announces links and delivers messages over them only', async () => {
    const net = new FakeNetwork();
    const a = node(net, 'a');
    const b = node(net, 'b');
    const c = node(net, 'c');
    net.connect('a', 'b');
    await b.t.setDesks(['d']);
    expect(await a.t.send(null, 'deskOps', 'd', { n: 1 })).toBe(1);
    net.deliver();
    expect(b.got.map((e) => e.type)).toEqual(['up', 'message']);
    expect(bodies(b.got)).toEqual([{ n: 1 }]);
    expect(c.got).toEqual([]);
  });

  it('drops messages for desks the receiver does not share', async () => {
    const net = new FakeNetwork();
    const a = node(net, 'a');
    const b = node(net, 'b');
    net.connect('a', 'b');
    await a.t.send(null, 'deskOps', 'other', { n: 1 });
    await a.t.send(null, 'presence', null, { n: 2 });
    net.settle();
    expect(bodies(b.got)).toEqual([{ n: 2 }]);
  });

  it('loses what was in flight when a link is cut', async () => {
    const net = new FakeNetwork();
    const a = node(net, 'a');
    const b = node(net, 'b');
    net.connect('a', 'b');
    net.deliver();
    await a.t.send(null, 'presence', null, 1);
    net.disconnect('a', 'b');
    net.settle();
    expect(bodies(b.got)).toEqual([]);
    expect(b.got.at(-1)).toMatchObject({ type: 'down', peer: 'a' });
  });

  it('reorders across links but keeps each link in order', async () => {
    const net = new FakeNetwork();
    const a = node(net, 'a');
    const b = node(net, 'b');
    const c = node(net, 'c');
    net.mesh();
    net.deliver();
    for (let i = 0; i < 20; i++) {
      await a.t.send('c', 'presence', null, `a${i}`);
      await b.t.send('c', 'presence', null, `b${i}`);
    }
    net.deliver({ shuffle: seeded(1) });
    const got = bodies(c.got) as string[];
    const lane = (p: string) => Array.from({ length: 20 }, (_, i) => `${p}${i}`);
    expect(got.filter((x) => x.startsWith('a'))).toEqual(lane('a'));
    expect(got.filter((x) => x.startsWith('b'))).toEqual(lane('b'));
    expect(got.slice(0, 20)).not.toEqual(lane('a'));
  });
});
