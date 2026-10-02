// What the local user is touching right now, or touched a moment ago. Local hands win: input
// mapping ignores incoming values for a widget while it is held and for HOLD_OFF_MS after,
// and sync defers showing peers' values for it. Keys are widget ids, or `widgetId#n` for one
// pad of a pads widget.
//
// Pointers are tracked by GridItem in the capture phase, so no widget needs its own code, and
// `pulse()` is called on every local change (which also covers keys and double-tap resets).
// A pointer that is released anywhere (even outside the widget) ends its hold, so a lost
// pointerup can never block a widget for good.

export const HOLD_OFF_MS = 250;

/** key → pointer ids holding it. */
const held = new Map<string, Set<number>>();
/** key → time of the last local change or release. */
const lastLocal = new Map<string, number>();
let now: () => number = () => performance.now();
let listening = false;

function listen() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  const release = (e: PointerEvent) => endPointer(e.pointerId);
  window.addEventListener('pointerup', release, true);
  window.addEventListener('pointercancel', release, true);
}

/** A pointer went down on `key`. */
export function begin(key: string, pointerId: number) {
  listen();
  let pointers = held.get(key);
  if (!pointers) held.set(key, (pointers = new Set()));
  pointers.add(pointerId);
  lastLocal.set(key, now());
}

/** A pointer was lifted: ends its hold on every key. */
export function endPointer(pointerId: number) {
  for (const [key, pointers] of held) {
    if (!pointers.delete(pointerId)) continue;
    lastLocal.set(key, now());
    if (pointers.size === 0) held.delete(key);
  }
}

/** A local change happened on `key` (pointer move, key press, reset). */
export function pulse(key: string) {
  lastLocal.set(key, now());
}

/** Whether `key` is held, or was changed locally less than `holdOffMs` ago. */
export function isTouched(key: string, holdOffMs = HOLD_OFF_MS): boolean {
  if (held.has(key)) return true;
  const last = lastLocal.get(key);
  return last !== undefined && now() - last < holdOffMs;
}

/** Whether a pointer is down on any of these widgets (or on one of their pads). */
export function holdsAny(widgetIds: ReadonlySet<string>): boolean {
  for (const key of held.keys()) if (widgetIds.has(key.split('#')[0]!)) return true;
  return false;
}

/** Tests only: a fake clock, and a clean slate. */
export function resetTouch(clock: () => number = () => performance.now()) {
  held.clear();
  lastLocal.clear();
  now = clock;
}
