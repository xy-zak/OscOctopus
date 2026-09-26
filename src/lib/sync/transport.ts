// The sync transport as the rest of the frontend sees it: send a message to one peer or to
// all, and receive peers coming and going with their messages, in order per peer
// (`up`, messages, `down`). The app uses the Rust transport; tests wire several in-memory
// ones together (fake.ts).
//
// Nothing here sends OSC, and nothing under src/lib/sync may: peer changes only update the
// display (see osc/flow.ts). A test enforces the import boundary.
import { sync } from '../ipc/commands';
import type { AppKind, SyncEvent } from '../ipc/types';

export interface Transport {
  /** Queues `body` for one peer, or every connected peer; resolves with how many. */
  send(peer: string | null, kind: AppKind, desk: string | null, body: unknown): Promise<number>;
  /** Desks shared (or being joined) here: peers' messages about other desks are dropped. */
  setDesks(desks: string[]): Promise<void>;
  /** Starts delivering events (once). `onDropped` hears of events lost to a full queue. */
  listen(
    onEvents: (events: SyncEvent[]) => void,
    onDropped: (count: number) => void,
  ): Promise<void>;
}

export const tauriTransport: Transport = {
  send: (peer, kind, desk, body) => sync.send(peer, kind, desk, JSON.stringify(body)),
  setDesks: (desks) => sync.setDesks(desks),
  listen: (onEvents, onDropped) =>
    sync.subscribe((batch) => {
      if (batch.dropped > 0) onDropped(batch.dropped);
      if (batch.events.length > 0) onEvents(batch.events);
    }),
};
