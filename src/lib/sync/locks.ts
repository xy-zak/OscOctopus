// Soft locks: a peer says in its presence which widgets it has selected (one open in its
// Inspector, or several moved together). Others see "Bob is editing": the Inspector is read-only
// for them and dragging is refused, unless they choose *Take over*. Advisory only: edits still
// merge per field if two people insist.
import type { Presence } from './protocol';

/** Peers editing a widget right now. */
export function editorsOf(
  presence: Readonly<Record<string, Presence>>,
  deskId: string,
  widgetId: string,
): string[] {
  return Object.entries(presence)
    .filter(([, p]) => p.editing?.desk === deskId && p.editing.widgets.includes(widgetId))
    .map(([peer]) => peer);
}

/** Peers looking at a desk (for the dots on its tab). */
export function viewersOf(presence: Readonly<Record<string, Presence>>, deskId: string): string[] {
  return Object.entries(presence)
    .filter(([, p]) => p.viewing === deskId)
    .map(([peer]) => peer);
}

/** Pairs of connected peers that say they aren't connected to each other. */
export function missingLinks(
  presence: Readonly<Record<string, Presence>>,
  connected: readonly string[],
): [string, string][] {
  const out: [string, string][] = [];
  for (const a of connected) {
    for (const b of connected) {
      if (a >= b) continue;
      const pa = presence[a];
      const pb = presence[b];
      if (pa && pb && !pa.neighbours.includes(b) && !pb.neighbours.includes(a)) out.push([a, b]);
    }
  }
  return out;
}

/** Shared desks more than one device forwards input for: device feedback would repeat. */
export function forwardingClashes(
  presence: Readonly<Record<string, Presence>>,
  mine: readonly string[],
): string[] {
  const count = new Map<string, number>();
  for (const id of mine) count.set(id, 1);
  for (const p of Object.values(presence))
    for (const id of p.forwarding) count.set(id, (count.get(id) ?? 0) + 1);
  return [...count].filter(([, n]) => n > 1).map(([id]) => id);
}
