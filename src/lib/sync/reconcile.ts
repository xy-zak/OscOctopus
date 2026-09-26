// Applies a merged desk to the open one in place: only what differs is written, and widgets
// and endpoints are matched by id and keep their identity. Keyed lists, the Inspector's bound
// widget and anything else holding a reference stay attached.
import { canonical } from '../canonical';
import type { Preset, Widget } from '../model/preset';

const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

type Obj = Record<string, unknown>;

/** Makes `target` field-for-field equal to `next` (plain, not shared with `target`). */
function patchObject(target: Obj, next: Obj) {
  for (const key of Object.keys(target)) if (!(key in next)) delete target[key];
  for (const [key, value] of Object.entries(next)) {
    if (!same(target[key], value)) target[key] = clone(value);
  }
}

/** Patches a widget in place; false if it can't be (another type): it is replaced instead. */
function patchWidget(target: Widget, next: Widget): boolean {
  if (target.type !== next.type) return false;
  const t = target as unknown as Obj;
  for (const [key, value] of Object.entries(next)) {
    if (key !== 'props' && !same(t[key], value)) t[key] = clone(value);
  }
  // Props one by one, so an Inspector bound to one prop isn't disturbed by another's change.
  patchObject(target.props as Obj, next.props as Obj);
  return true;
}

function patchList<T extends { id: string }>(
  target: T[],
  next: readonly T[],
  patch: (t: T, n: T) => boolean,
) {
  const byId = new Map(target.map((t) => [t.id, t]));
  const ordered = next.map((n) => {
    const t = byId.get(n.id);
    return t && patch(t, n) ? t : clone(n);
  });
  const unchanged = ordered.length === target.length && ordered.every((t, i) => t === target[i]);
  if (!unchanged) target.splice(0, target.length, ...ordered);
}

/** Makes the open desk `target` equal to `next`, touching only what differs. */
export function patchInPlace(target: Preset, next: Preset) {
  if (target.name !== next.name) target.name = next.name;
  if (target.color !== next.color) target.color = next.color;
  patchObject(target.grid as unknown as Obj, next.grid as unknown as Obj);
  patchList(target.widgets, next.widgets, patchWidget);
  patchList(target.network.outputs, next.network.outputs, (t, n) => {
    patchObject(t as unknown as Obj, n as unknown as Obj);
    return true;
  });
  patchList(target.network.inputs, next.network.inputs, (t, n) => {
    patchObject(t as unknown as Obj, n as unknown as Obj);
    return true;
  });
}
