// A shared desk's record: for every key (paths.ts), the latest change anyone made, with its
// stamp. Merging keeps the later change per key, so replicas that have seen the same changes
// hold the same record, whatever order they arrived in (merge is commutative, associative
// and idempotent). A deletion is an entry too, a tombstone, and is kept forever: a peer that
// was away can't bring back what was deleted meanwhile.
import { canonical } from '../canonical';
import { compareStamps } from './hlc';
import type { Flat, RecordView } from './paths';
import type { Stamp, WireEntry } from './protocol';

export interface Entry {
  stamp: Stamp;
  /** Absent for a tombstone. */
  value?: unknown;
  deleted?: true;
}

/** Canonical text of an entry's content, cached (records are compared and hashed often). */
const contentCache = new WeakMap<Entry, string>();
function content(e: Entry): string {
  let c = contentCache.get(e);
  if (c === undefined) {
    c = e.deleted ? '\u0000deleted' : canonical(e.value);
    contentCache.set(e, c);
  }
  return c;
}

/**
 * Whether `a` beats `b`: the later stamp, and for the same stamp (the same change twice, or a
 * buggy or forged peer) the larger content, so every replica picks the same one.
 */
function beats(a: Entry, b: Entry): boolean {
  const c = compareStamps(a.stamp, b.stamp);
  return c !== 0 ? c > 0 : content(a) > content(b);
}

export const fromWire = (e: WireEntry): Entry =>
  e.length === 3 ? { stamp: e[1], value: e[2] } : { stamp: e[1], deleted: true };

export const toWire = (key: string, e: Entry): WireEntry =>
  e.deleted ? [key, e.stamp] : [key, e.stamp, e.value];

/** 64 bits of FNV-1a (two independent 32-bit lanes), as hex. Not cryptographic. */
function hash64(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x050c5d1f;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x01000193) ^ (h2 >>> 13);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

export class DeskDoc implements RecordView {
  readonly entries = new Map<string, Entry>();

  constructor(
    readonly deskId: string,
    readonly doc: string,
  ) {}

  /** Merges entries in; returns the keys whose winning entry changed. */
  merge(entries: Iterable<[string, Entry]>): string[] {
    const changed: string[] = [];
    for (const [key, next] of entries) {
      const cur = this.entries.get(key);
      if (!cur || beats(next, cur)) {
        this.entries.set(key, next);
        changed.push(key);
      }
    }
    return changed;
  }

  mergeWire(entries: readonly WireEntry[]): string[] {
    return this.merge(entries.map((e) => [e[0], fromWire(e)] as [string, Entry]));
  }

  live(key: string): unknown {
    const e = this.entries.get(key);
    return e && !e.deleted ? e.value : undefined;
  }

  stamp(key: string): Stamp | undefined {
    return this.entries.get(key)?.stamp;
  }

  keys(): Iterable<string> {
    return this.entries.keys();
  }

  isDeleted(key: string): boolean {
    return this.entries.get(key)?.deleted === true;
  }

  /** The whole record (or some keys of it) for the wire. */
  wire(keys: Iterable<string> = this.entries.keys()): WireEntry[] {
    const out: WireEntry[] = [];
    for (const key of keys) {
      const e = this.entries.get(key);
      if (e) out.push(toWire(key, e));
    }
    return out;
  }

  /** The latest stamp in the record (seeds the clock, so it never stamps behind it). */
  maxStamp(): Stamp | undefined {
    let max: Stamp | undefined;
    for (const e of this.entries.values())
      if (!max || compareStamps(e.stamp, max) > 0) max = e.stamp;
    return max;
  }

  /** Equal digests mean equal records: every key, stamp and content. */
  digest(): string {
    const keys = [...this.entries.keys()].sort();
    let text = '';
    for (const key of keys) {
      const e = this.entries.get(key)!;
      text += `${key}\u0001${e.stamp.join(',')}\u0001${hash64(content(e))}\u0002`;
    }
    return hash64(text);
  }
}

/** Fields of a desk that differ from what was last in sync (`base`: key → canonical value). */
export function localChanges(
  flat: Flat,
  base: ReadonlyMap<string, string>,
): { changed: [string, unknown][]; missing: string[] } {
  const changed: [string, unknown][] = [];
  for (const [key, value] of flat) {
    if (base.get(key) !== canonical(value)) changed.push([key, value]);
  }
  const missing = [...base.keys()].filter((key) => !flat.has(key));
  return { changed, missing };
}

/** `base` for a desk as it is now. */
export function baseOf(flat: Flat): Map<string, string> {
  return new Map([...flat].map(([k, v]) => [k, canonical(v)]));
}
