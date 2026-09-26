// An in-memory sync network for tests: several transports, links that can be cut and
// restored, and delivery the test controls. It can deliver late, reorder (across peers only:
// the real transport keeps each link in order), duplicate and drop.
import type { AppKind, PeerInfo, SyncEvent } from '../ipc/types';
import type { Transport } from './transport';

interface Envelope {
  from: string;
  to: string;
  event: SyncEvent;
}

export interface DeliverOptions {
  /** Shuffle the order between different links (each link stays in order). */
  shuffle?: () => number;
  /** Deliver each message twice. */
  duplicate?: boolean;
  /** Drop messages of these kinds (e.g. values under load). */
  drop?: AppKind[];
  /** Drop a message when this returns true (random loss). */
  lose?: () => boolean;
}

export class FakeNetwork {
  private nodes = new Map<string, FakeTransport>();
  private links = new Set<string>();
  private queue: Envelope[] = [];

  add(peerId: string, name = peerId): FakeTransport {
    const node = new FakeTransport(this, peerId, name);
    this.nodes.set(peerId, node);
    return node;
  }

  private static key(a: string, b: string) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  linked(a: string, b: string): boolean {
    return this.links.has(FakeNetwork.key(a, b));
  }

  /** Connects two peers: each hears the other come up. */
  connect(a: string, b: string) {
    if (this.linked(a, b)) return;
    this.links.add(FakeNetwork.key(a, b));
    this.queue.push({ from: b, to: a, event: { type: 'up', peer: this.info(b) } });
    this.queue.push({ from: a, to: b, event: { type: 'up', peer: this.info(a) } });
  }

  /** Cuts a link: queued messages on it are lost, and each side hears the other go down. */
  disconnect(a: string, b: string) {
    if (!this.linked(a, b)) return;
    this.links.delete(FakeNetwork.key(a, b));
    this.queue = this.queue.filter((e) => FakeNetwork.key(e.from, e.to) !== FakeNetwork.key(a, b));
    this.nodes.get(a)?.receive([{ type: 'down', peer: b, reason: 'link cut' }]);
    this.nodes.get(b)?.receive([{ type: 'down', peer: a, reason: 'link cut' }]);
  }

  /** Every pair connected. */
  mesh() {
    const ids = [...this.nodes.keys()];
    for (const a of ids) for (const b of ids) if (a < b) this.connect(a, b);
  }

  pending(): number {
    return this.queue.length;
  }

  /** Delivers everything queued so far (not what that triggers); returns how many. */
  deliver(opts: DeliverOptions = {}): number {
    let batch = this.queue;
    this.queue = [];
    if (opts.shuffle) batch = shuffleAcrossLinks(batch, opts.shuffle);
    let count = 0;
    for (const env of batch) {
      if (!this.linked(env.from, env.to)) continue;
      const { event } = env;
      if (event.type === 'message' && (opts.drop?.includes(event.kind) || opts.lose?.())) continue;
      const node = this.nodes.get(env.to);
      if (!node) continue;
      node.receive(opts.duplicate && event.type === 'message' ? [event, event] : [event]);
      count++;
    }
    return count;
  }

  /** Delivers until nothing is left (or `maxRounds`, against endless chatter). */
  settle(opts: DeliverOptions = {}, maxRounds = 50) {
    for (let i = 0; i < maxRounds && this.queue.length > 0; i++) this.deliver(opts);
  }

  /** Called by a transport. */
  post(from: string, to: string | null, kind: AppKind, desk: string | null, body: unknown): number {
    const node = this.nodes.get(from);
    if (!node) return 0;
    const targets = [...this.nodes.keys()].filter(
      (id) => id !== from && this.linked(from, id) && (to === null || to === id),
    );
    for (const target of targets) {
      const deskOk = desk === null || this.nodes.get(target)!.desks.has(desk);
      if (!deskOk) continue;
      // A structured clone, like JSON over the wire: nothing is shared by reference.
      const copy = JSON.parse(JSON.stringify(body)) as unknown;
      this.queue.push({
        from,
        to: target,
        event: { type: 'message', peer: from, kind, desk, body: copy },
      });
    }
    return targets.length;
  }

  private info(peerId: string): PeerInfo {
    const node = this.nodes.get(peerId)!;
    return {
      peerId,
      fingerprint: peerId,
      name: node.name,
      color: 0,
      appVersion: 'test',
      address: `fake:${peerId}`,
    };
  }
}

export class FakeTransport implements Transport {
  desks = new Set<string>();
  private handler: ((events: SyncEvent[]) => void) | null = null;

  constructor(
    private network: FakeNetwork,
    readonly peerId: string,
    readonly name: string,
  ) {}

  async send(peer: string | null, kind: AppKind, desk: string | null, body: unknown) {
    return this.network.post(this.peerId, peer, kind, desk, body);
  }

  async setDesks(desks: string[]) {
    this.desks = new Set(desks);
  }

  async listen(onEvents: (events: SyncEvent[]) => void) {
    this.handler = onEvents;
  }

  receive(events: SyncEvent[]) {
    this.handler?.(events);
  }
}

/** Interleaves links randomly while keeping each link's own order. */
function shuffleAcrossLinks(batch: Envelope[], random: () => number): Envelope[] {
  const perLink = new Map<string, Envelope[]>();
  for (const e of batch) {
    const k = `${e.from}>${e.to}`;
    perLink.set(k, [...(perLink.get(k) ?? []), e]);
  }
  const lanes = [...perLink.values()];
  const out: Envelope[] = [];
  while (lanes.length > 0) {
    const i = Math.floor(random() * lanes.length);
    out.push(lanes[i]!.shift()!);
    if (lanes[i]!.length === 0) lanes.splice(i, 1);
  }
  return out;
}
