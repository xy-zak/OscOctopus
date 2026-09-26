// The typed message bus over a transport: validates every message (protocol.ts), so handlers
// only ever see well-formed bodies, and tracks which peers are connected. Plain (no Svelte),
// so tests can run several over the in-memory network.
import type { AppKind, PeerInfo, SyncEvent } from '../ipc/types';
import { parseBody, type Bodies } from './protocol';
import type { Transport } from './transport';

export type PeerChange =
  { type: 'up'; peer: PeerInfo } | { type: 'down'; peer: string; reason: string };
export type MessageHandler<K extends AppKind> = (
  peer: string,
  desk: string | null,
  body: Bodies[K],
) => void;

export interface BusHooks {
  /** A message failed validation (it was dropped). */
  rejected?(peer: string, kind: AppKind, error: string): void;
  /** Sending failed (IPC error). */
  sendFailed?(kind: AppKind, error: unknown): void;
}

export class SyncBus {
  readonly peers = new Map<string, PeerInfo>();
  private handlers = new Map<AppKind, Set<MessageHandler<AppKind>>>();
  private peerHandlers = new Set<(change: PeerChange) => void>();

  constructor(
    private transport: Transport,
    private hooks: BusHooks = {},
  ) {}

  listen(onDropped: (count: number) => void = () => {}): Promise<void> {
    return this.transport.listen((events) => this.dispatch(events), onDropped);
  }

  /** Handles one kind of message (validated). Returns an unsubscribe function. */
  on<K extends AppKind>(kind: K, handler: MessageHandler<K>): () => void {
    const set = this.handlers.get(kind) ?? new Set();
    this.handlers.set(kind, set);
    const h = handler as unknown as MessageHandler<AppKind>;
    set.add(h);
    return () => set.delete(h);
  }

  /** Hears peers come and go, in order with their messages. */
  onPeers(handler: (change: PeerChange) => void): () => void {
    this.peerHandlers.add(handler);
    return () => this.peerHandlers.delete(handler);
  }

  /** Queues a message for one peer, or every connected peer. Never throws. */
  async send<K extends AppKind>(
    peer: string | null,
    kind: K,
    desk: string | null,
    body: Bodies[K],
  ): Promise<number> {
    try {
      return await this.transport.send(peer, kind, desk, body);
    } catch (e) {
      this.hooks.sendFailed?.(kind, e);
      return 0;
    }
  }

  setDesks(desks: string[]): Promise<void> {
    return this.transport.setDesks(desks);
  }

  private dispatch(events: SyncEvent[]) {
    for (const e of events) {
      if (e.type === 'up') {
        this.peers.set(e.peer.peerId, e.peer);
        for (const h of this.peerHandlers) h(e);
      } else if (e.type === 'down') {
        this.peers.delete(e.peer);
        for (const h of this.peerHandlers) h(e);
      } else {
        const parsed = parseBody(e.kind, e.body);
        if (!parsed.ok) {
          this.hooks.rejected?.(e.peer, e.kind, parsed.error);
          continue;
        }
        for (const h of this.handlers.get(e.kind) ?? []) h(e.peer, e.desk, parsed.body);
      }
    }
  }
}
