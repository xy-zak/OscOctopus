// A small hub for things other modules react to, without importing each other: the sender
// side (osc/flow.ts, the workspace store) announces local changes here, and sync subscribes.
// Keeping sync out of the sender's import graph is what makes "peer changes never send OSC"
// true by construction (see sync/boundary.test.ts).
import type { WidgetValue } from '../osc/value';

export type LocalOrigin = 'touch' | 'input';

/** A widget value changed because of this device (a gesture, or matched OSC input). */
export interface LocalValueChange {
  deskId: string;
  widgetId: string;
  value: WidgetValue;
  origin: LocalOrigin;
  /** End of a gesture (pointer up, key press): the resting value. */
  final: boolean;
}

/** A desk's contents changed. `remote` changes came from sync and must not be re-shared. */
export interface DeskChange {
  deskId: string;
  origin: 'local' | 'remote';
  /** Sync keys deleted on purpose by this change (`w/<id>`, `o/<id>`, `i/<id>`). */
  deleted?: string[];
}

/** The sync keys of things a change can delete (see sync/paths.ts for the full key grammar). */
export const syncKey = {
  widget: (id: string) => `w/${id}`,
  output: (id: string) => `o/${id}`,
  input: (id: string) => `i/${id}`,
};

type Listener<T> = (change: T) => void;

function hub<T>() {
  const listeners = new Set<Listener<T>>();
  return {
    on(fn: Listener<T>): () => void {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    emit(change: T) {
      for (const fn of listeners) fn(change);
    },
  };
}

export const localValues = hub<LocalValueChange>();
export const deskChanges = hub<DeskChange>();

/**
 * Sync's record of a shared desk, saved together with the desk (set by sync/shared.svelte.ts,
 * so the workspace needn't import sync). Null for a desk that isn't shared.
 */
export const syncRecords: { of: (deskId: string) => unknown } = { of: () => null };

/**
 * Whether this device forwards received OSC input for a desk (set by sync: on a shared desk,
 * only the device chosen as its forwarder does, so device feedback isn't forwarded N times).
 */
export const forwardPolicy: { mayForward: (deskId: string) => boolean } = {
  mayForward: () => true,
};
