// Shared desks end to end: several devices, each with its own workspace, over the in-memory
// network. Covers sharing and joining, concurrent and offline edits, deletions, a partial
// mesh, FREEZE, mass deletes, network changes, lineage, live values, and a seeded
// convergence test with reordered, duplicated and lost messages and partitions.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canonical } from '../canonical';
import { newPreset, withFreshWidgetIds } from '../model/factory';
import { uid } from '../model/parts';
import type { Preset, Widget } from '../model/preset';
import type { WidgetValue } from '../osc/value';
import { newWidget } from '../widgets/defs';
import { SyncBus } from './bus';
import { FakeNetwork, type DeliverOptions } from './fake';
import { flatten } from './paths';
import { patchInPlace } from './reconcile';
import { DIFF_MS, SharedDesks, type ConfirmOptions, type Workspace } from './shared.svelte';

const A = 'aaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbb';
const C = 'cccccccccccccccc';

class FakeWorkspace implements Workspace {
  list: Preset[] = [];
  library = new Map<string, Preset>();
  records = new Map<string, unknown>();
  networkApplies = 0;
  shared!: SharedDesks;

  desks() {
    return this.list;
  }
  find(id: string) {
    return this.list.find((d) => d.id === id);
  }
  snapshot(id: string) {
    return structuredClone(this.find(id)!);
  }
  hasSaved(id: string) {
    return this.library.has(id);
  }
  async open(id: string) {
    if (!this.find(id)) this.list.push(structuredClone(this.library.get(id)!));
  }
  async adopt(desk: Preset) {
    this.list.push(desk);
    await this.save(desk.id);
  }
  applyRemote(id: string, next: Preset, network: boolean) {
    patchInPlace(this.find(id)!, next);
    if (network) this.networkApplies++;
  }
  async duplicate(id: string, name: string) {
    const copy = withFreshWidgetIds(this.snapshot(id));
    copy.id = uid('p');
    copy.name = name;
    this.list.push(copy);
    this.library.set(copy.id, copy);
  }
  async save(id: string) {
    const desk = this.find(id);
    if (desk) this.library.set(id, structuredClone(desk));
    const record = this.shared.recordFile(id);
    if (record) this.records.set(id, structuredClone(record));
  }
  blank(id: string, name: string) {
    return { ...newPreset(name), id };
  }
  addDesk(desk: Preset) {
    this.list.push(desk);
    this.library.set(desk.id, structuredClone(desk));
    return desk;
  }
}

class Device {
  ws = new FakeWorkspace();
  shared: SharedDesks;
  bus: SyncBus;
  locked = false;
  paused = false;
  answers: boolean[] = [];
  asked: ConfirmOptions[] = [];
  notes: string[] = [];
  warnings: string[] = [];
  touched = new Set<string>();
  shown: [string, WidgetValue, string][] = [];
  private docs = 0;

  constructor(
    net: FakeNetwork,
    readonly id: string,
  ) {
    this.bus = new SyncBus(net.add(id, `dev-${id[0]}`));
    this.shared = new SharedDesks(this.ws, {
      bus: this.bus,
      peerId: () => id,
      joined: () => true,
      peerName: (p) => `dev-${p[0]}`,
      locked: () => this.locked,
      paused: () => this.paused,
      confirm: async (opts) => {
        this.asked.push(opts);
        return this.answers.shift() ?? true;
      },
      note: (t) => this.notes.push(t),
      warn: (t) => this.warnings.push(t),
      loadRecord: async (deskId) => this.ws.records.get(deskId) ?? null,
      isTouched: (key) => this.touched.has(key),
      show: (w: Widget, v, origin) => this.shown.push([w.id, v, origin]),
      now: () => Date.now(),
      newDocId: () => `${id.slice(0, 8)}${String(++this.docs).padStart(8, '0')}`,
    });
    this.ws.shared = this.shared;
  }

  async start() {
    await this.bus.listen();
    this.shared.start();
    return this;
  }

  desk(id: string) {
    return this.ws.find(id)!;
  }

  /** A local edit, as the workspace reports it to sync. */
  edit(deskId: string, fn: (d: Preset) => void, deleted?: string[]) {
    fn(this.desk(deskId));
    this.shared.localChange({ deskId, origin: 'local', deleted });
  }

  removeWidget(deskId: string, widgetId: string) {
    this.edit(deskId, (d) => (d.widgets = d.widgets.filter((w) => w.id !== widgetId)), [
      `w/${widgetId}`,
    ]);
  }
}

async function devices<const Ids extends readonly string[]>(net: FakeNetwork, ...ids: Ids) {
  const all = await Promise.all(ids.map((id) => new Device(net, id).start()));
  return all as { [K in keyof Ids]: Device };
}

/** Runs timers and delivers messages until the network is quiet. */
async function pump(
  net: FakeNetwork,
  all: readonly Device[],
  opts: DeliverOptions = {},
  rounds = 40,
) {
  let quiet = 0;
  for (let i = 0; i < rounds && quiet < 2; i++) {
    await vi.advanceTimersByTimeAsync(DIFF_MS + 10);
    const n = net.deliver(opts);
    for (const d of all) for (const desk of d.ws.list) await d.shared.settled(desk.id);
    quiet = n === 0 && net.pending() === 0 ? quiet + 1 : 0;
  }
}

/** What peers must agree on: every shared field. */
const shape = (d: Preset | undefined) => (d ? canonical(Object.fromEntries(flatten(d))) : 'none');

/** A shares a new desk, the others open it from A's announcement. */
async function sharedDesk(
  net: FakeNetwork,
  owner: Device,
  others: Device[],
  desk = newPreset('Stage'),
) {
  owner.ws.addDesk(desk);
  await owner.shared.share(desk.id);
  net.mesh();
  await pump(net, [owner, ...others]);
  for (const d of others) {
    const entry = Object.values(d.shared.available)
      .flat()
      .find((e) => e.id === desk.id)!;
    const from = Object.keys(d.shared.available).find((p) =>
      d.shared.available[p]!.some((e) => e.id === desk.id),
    )!;
    await d.shared.open(from, entry);
    await pump(net, [owner, ...others]);
  }
  return desk.id;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
});
afterEach(() => vi.useRealTimers());

describe('shared desks', () => {
  it('a peer joins a shared desk and gets it whole', async () => {
    const net = new FakeNetwork();
    const [a, b] = await devices(net, A, B);
    const id = await sharedDesk(net, a, [b]);
    expect(b.desk(id)).toBeDefined();
    expect(shape(b.desk(id))).toBe(shape(a.desk(id)));
    expect(b.shared.isShared(id)).toBe(true);
    expect(b.ws.records.get(id)).toMatchObject({ deskId: id, shared: true });
  });

  it('concurrent edits of different fields both survive; the same field: the later wins', async () => {
    const net = new FakeNetwork();
    const [a, b] = await devices(net, A, B);
    const id = await sharedDesk(net, a, [b]);
    const [w0, w1] = a.desk(id).widgets.map((w) => w.id);

    a.edit(id, (d) => (d.widgets[0]!.label = 'From A'));
    b.edit(id, (d) => {
      (d.widgets[0]!.props as { max: number }).max = 10;
      d.widgets[1]!.label = 'From B';
    });
    a.edit(id, (d) => (d.name = 'Earlier'));
    a.shared.recordFile(id); // take the edits in now
    vi.advanceTimersByTime(5);
    b.edit(id, (d) => (d.name = 'Later'));
    await pump(net, [a, b]);

    for (const d of [a, b]) {
      const desk = d.desk(id);
      expect(desk.widgets.find((w) => w.id === w0)!.label).toBe('From A');
      expect((desk.widgets.find((w) => w.id === w0)!.props as { max: number }).max).toBe(10);
      expect(desk.widgets.find((w) => w.id === w1)!.label).toBe('From B');
      expect(desk.name).toBe('Later');
    }
    expect(shape(a.desk(id))).toBe(shape(b.desk(id)));
  });

  it('offline edits on both sides merge when they reconnect', async () => {
    const net = new FakeNetwork();
    const [a, b] = await devices(net, A, B);
    const id = await sharedDesk(net, a, [b]);
    const [w0, w1] = a.desk(id).widgets.map((w) => w.id);
    net.disconnect(A, B);
    a.edit(id, (d) => (d.widgets[0]!.label = 'Offline A'));
    b.removeWidget(id, w1!);
    await pump(net, [a, b]);
    expect(a.desk(id).widgets.some((w) => w.id === w1)).toBe(true);

    net.connect(A, B);
    await pump(net, [a, b]);
    for (const d of [a, b]) {
      expect(d.desk(id).widgets.find((w) => w.id === w0)!.label).toBe('Offline A');
      expect(d.desk(id).widgets.some((w) => w.id === w1)).toBe(false);
    }
  });

  it('a deletion beats a concurrent edit', async () => {
    const net = new FakeNetwork();
    const [a, b] = await devices(net, A, B);
    const id = await sharedDesk(net, a, [b]);
    const w0 = a.desk(id).widgets[0]!.id;
    a.removeWidget(id, w0);
    b.edit(id, (d) => (d.widgets.find((w) => w.id === w0)!.label = 'Edited meanwhile'));
    await pump(net, [a, b]);
    for (const d of [a, b]) expect(d.desk(id).widgets.some((w) => w.id === w0)).toBe(false);
  });

  it('never infers a deletion: a widget gone without one comes back', async () => {
    const net = new FakeNetwork();
    const [a, b] = await devices(net, A, B);
    const id = await sharedDesk(net, a, [b]);
    const w0 = a.desk(id).widgets[0]!.id;
    a.edit(id, (d) => (d.widgets = d.widgets.filter((w) => w.id !== w0)));
    await pump(net, [a, b]);
    for (const d of [a, b]) expect(d.desk(id).widgets.some((w) => w.id === w0)).toBe(true);
  });

  it('digests repair a partial mesh (A↔B↔C without A↔C)', async () => {
    const net = new FakeNetwork();
    const [a, b, c] = await devices(net, A, B, C);
    const id = await sharedDesk(net, a, [b, c]);
    net.disconnect(A, C);
    a.edit(id, (d) => (d.name = 'Only A and B know'));
    await pump(net, [a, b, c]);
    expect(b.desk(id).name).toBe('Only A and B know');
    expect(c.desk(id).name).not.toBe('Only A and B know');

    for (const d of [a, b, c]) d.shared.sendDigests();
    await pump(net, [a, b, c]);
    expect(c.desk(id).name).toBe('Only A and B know');
    expect(shape(c.desk(id))).toBe(shape(a.desk(id)));
  });

  it('while FROZEN, remote edits wait until unfrozen', async () => {
    const net = new FakeNetwork();
    const [a, b] = await devices(net, A, B);
    const id = await sharedDesk(net, a, [b]);
    b.locked = true;
    a.edit(id, (d) => (d.name = 'Changed during the show'));
    await pump(net, [a, b]);
    expect(b.desk(id).name).toBe('Stage');
    expect(b.shared.view[id]?.waiting).toBe(true);

    b.locked = false;
    b.shared.unlocked();
    expect(b.desk(id).name).toBe('Changed during the show');
    expect(b.shared.view[id]?.waiting).toBe(false);
  });

  it('a mass delete asks first, and keeping the widgets restores them for everyone', async () => {
    const net = new FakeNetwork();
    const [a, b] = await devices(net, A, B);
    const desk = newPreset('Big');
    desk.grid = { cols: 48, rows: 48, gap: 4 };
    for (let i = 0; i < 12; i++)
      desk.widgets.push(newWidget('slider', { x: i, y: 10, w: 1, h: 4 }, [], i + 10));
    const id = await sharedDesk(net, a, [b], desk);
    const doomed = a
      .desk(id)
      .widgets.slice(0, 12)
      .map((w) => w.id);

    b.answers.push(false); // Keep them
    for (const w of doomed) a.removeWidget(id, w);
    await pump(net, [a, b]);

    expect(b.asked[0]?.title).toBe('Delete widgets');
    for (const d of [a, b]) {
      const ids = d.desk(id).widgets.map((w) => w.id);
      for (const w of doomed) expect(ids).toContain(w);
    }
    expect(shape(a.desk(id))).toBe(shape(b.desk(id)));
  });

  it('a remote network change is applied, logged, and keeps this machine’s bind address', async () => {
    const net = new FakeNetwork();
    const [a, b] = await devices(net, A, B);
    const id = await sharedDesk(net, a, [b]);
    const out = a.desk(id).network.outputs[0]!.id;
    b.desk(id).network.outputs[0]!.bindAddress = '10.0.0.9';
    b.shared.recordFile(id);
    const applies = b.ws.networkApplies;

    a.edit(id, (d) => (d.network.outputs[0]!.host = '192.168.1.50'));
    await pump(net, [a, b]);

    const mine = b.desk(id).network.outputs.find((o) => o.id === out)!;
    expect(mine.host).toBe('192.168.1.50');
    expect(mine.bindAddress).toBe('10.0.0.9');
    expect(b.ws.networkApplies).toBeGreaterThan(applies);
    expect(b.notes.some((n) => n.includes('192.168.1.50'))).toBe(true);
    // B's bind address is its own: it never reached A.
    expect(a.desk(id).network.outputs[0]!.bindAddress).toBe('0.0.0.0');
  });

  it('a local desk with the same id but another lineage is kept as a copy, not merged', async () => {
    const net = new FakeNetwork();
    const [a, b] = await devices(net, A, B);
    const theirs = newPreset('Theirs');
    const mine = { ...newPreset('Mine'), id: theirs.id };
    b.ws.addDesk(mine);
    a.ws.addDesk(theirs);
    await a.shared.share(theirs.id);
    net.mesh();
    await pump(net, [a, b]);

    b.answers.push(true);
    await b.shared.open(A, b.shared.available[A]![0]!);
    await pump(net, [a, b]);

    expect(b.asked[0]?.title).toBe('Same id, different desk');
    expect(b.desk(theirs.id).name).toBe('Theirs');
    expect(shape(b.desk(theirs.id))).toBe(shape(a.desk(theirs.id)));
    expect(b.ws.list.some((d) => d.name === 'Mine (mine)')).toBe(true);
  });

  it('live values reach peers, wait while touched there, and stay home while PAUSED', async () => {
    const net = new FakeNetwork();
    const [a, b] = await devices(net, A, B);
    const id = await sharedDesk(net, a, [b]);
    const fader = a.desk(id).widgets.find((w) => w.type === 'slider')!.id;
    const touch = (d: Device, value: number) =>
      d.shared.localValue({ deskId: id, widgetId: fader, value, origin: 'touch', final: true });

    touch(a, 0.5);
    await pump(net, [a, b]);
    expect(b.shown).toContainEqual([fader, 0.5, 'peer']);

    b.touched.add(fader);
    touch(a, 0.7);
    await pump(net, [a, b]);
    expect(b.shown.some(([, v]) => v === 0.7)).toBe(false);
    b.touched.delete(fader);
    await vi.advanceTimersByTimeAsync(200);
    expect(b.shown.at(-1)).toEqual([fader, 0.7, 'peer']);

    a.paused = true;
    touch(a, 0.9);
    await pump(net, [a, b]);
    a.shared.values.refresh();
    await pump(net, [a, b]);
    expect(b.shown.some(([, v]) => v === 0.9)).toBe(false);
  });

  it('refuses peer values that its widgets can’t hold', async () => {
    const net = new FakeNetwork();
    const [a, b] = await devices(net, A, B);
    const id = await sharedDesk(net, a, [b]);
    const fader = a.desk(id).widgets.find((w) => w.type === 'slider')!.id;
    const doc = (b.ws.records.get(id) as { doc: string }).doc;
    await a.bus.send(null, 'values', id, {
      doc,
      regs: [[fader, [Date.now(), 0, A], 42]],
    });
    await pump(net, [a, b]);
    expect(b.shown).toEqual([]);
  });
});

describe('convergence', () => {
  /** A seeded pseudo-random source, so a failure can be replayed. */
  function seeded(seed: number) {
    return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  }

  it.each([1, 7, 42])(
    'three devices converge after random edits, loss, reordering and partitions (seed %i)',
    async (seed) => {
      const random = seeded(seed);
      const pick = <T>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)]!;
      const net = new FakeNetwork();
      const all = await devices(net, A, B, C);
      const desk = newPreset('Stage');
      desk.grid = { cols: 48, rows: 48, gap: 4 };
      const id = await sharedDesk(net, all[0]!, all.slice(1), desk);
      const pairs: [string, string][] = [
        [A, B],
        [B, C],
        [A, C],
      ];
      let n = 0;

      for (let step = 0; step < 150; step++) {
        const d = pick(all);
        const widgets = d.desk(id).widgets;
        const roll = random();
        if (roll < 0.25 && widgets.length) {
          const w = pick(widgets).id;
          d.edit(id, (x) => (x.widgets.find((v) => v.id === w)!.label = `L${step}`));
        } else if (roll < 0.45 && widgets.length) {
          const w = pick(widgets).id;
          d.edit(id, (x) =>
            Object.assign(
              x.widgets.find((v) => v.id === w)!,
              { x: step % 40 },
            ),
          );
        } else if (roll < 0.6) {
          d.edit(id, (x) =>
            x.widgets.push(newWidget('slider', { x: 0, y: 20, w: 1, h: 2 }, [], ++n)),
          );
        } else if (roll < 0.7 && widgets.length > 2) {
          d.removeWidget(id, pick(widgets).id);
        } else if (roll < 0.8) {
          d.edit(id, (x) => (x.name = `Name ${step}`));
        } else if (roll < 0.9) {
          const [p, q] = pick(pairs);
          if (net.linked(p, q)) net.disconnect(p, q);
          else net.connect(p, q);
        }
        await vi.advanceTimersByTimeAsync(Math.floor(random() * 80));
        if (random() < 0.5) {
          net.deliver({ shuffle: random, duplicate: random() < 0.2, lose: () => random() < 0.2 });
          for (const x of all) await x.shared.settled(id);
        }
      }

      // Heal: everyone connected, digests until everything agrees.
      net.mesh();
      for (let round = 0; round < 6; round++) {
        await pump(net, all);
        for (const x of all) x.shared.sendDigests();
        await pump(net, all);
      }
      const records = all.map((x) =>
        canonical([...x.shared.recordFile(id)!.entries].sort((p, q) => (p[0] < q[0] ? -1 : 1))),
      );
      // It really did change (and not just stay as shared).
      expect(all[0]!.desk(id).name).not.toBe('Stage');
      expect(records[1]).toBe(records[0]);
      expect(records[2]).toBe(records[0]);
      expect(shape(all[1]!.desk(id))).toBe(shape(all[0]!.desk(id)));
      expect(shape(all[2]!.desk(id))).toBe(shape(all[0]!.desk(id)));
    },
    20_000,
  );
});
