// Lenient conversions for values arriving from outside (OSC input, sync peers): whatever
// type a sender used, turn it into what a widget needs, or `undefined` if it can't mean
// that. Pure, dependency-free (widget defs import it); tested in input.test.ts.
import { clamp } from '../util';
import { stepOf } from './curves';
import { isList, type Scalar, type ValueList } from './value';

export type Loose = Scalar | ValueList | undefined;

const first = (v: Loose): Scalar | undefined => (isList(v) ? v[0] : v);

export function toNumber(v: Loose): number | undefined {
  const x = first(v);
  if (typeof x === 'number') return Number.isFinite(x) ? x : undefined;
  if (typeof x === 'boolean') return x ? 1 : 0;
  if (typeof x === 'string' && x.trim() !== '') {
    const n = Number(x);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function toInteger(v: Loose): number | undefined {
  const n = toNumber(v);
  return n !== undefined && Number.isInteger(n) ? n : undefined;
}

const TRUE_WORDS = new Set(['true', 'on', 'yes', '1']);
const FALSE_WORDS = new Set(['false', 'off', 'no', '0']);

export function toBoolean(v: Loose): boolean | undefined {
  const x = first(v);
  if (typeof x === 'boolean') return x;
  if (typeof x === 'number') return Number.isFinite(x) ? x !== 0 : undefined;
  if (typeof x === 'string') {
    const word = x.trim().toLowerCase();
    if (TRUE_WORDS.has(word)) return true;
    if (FALSE_WORDS.has(word)) return false;
  }
  return undefined;
}

/** A finite number within [a, b], whichever way round the range is written. */
export function isNumberIn(v: unknown, a: number, b: number): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= Math.min(a, b) && v <= Math.max(a, b);
}

/** A record with exactly these keys (a value from a peer carries nothing extra). */
export function hasExactKeys(v: unknown, keys: readonly string[]): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const own = Object.keys(v);
  return own.length === keys.length && keys.every((k) => own.includes(k));
}

/** Clamps into [a, b] whichever way round the range is written. */
export function clampTo(v: number, a: number, b: number): number {
  return clamp(v, Math.min(a, b), Math.max(a, b));
}

/**
 * `on` or `off`, whichever `v` means: booleans and on/off words pick directly, numbers pick
 * the nearer of the two (so an f32-rounded 0.99999 still means 1). Undefined if on === off
 * (the two states can't be told apart) or `v` means neither.
 */
export function nearestOnOff(v: Loose, on: number, off: number): number | undefined {
  if (on === off) return undefined;
  const x = first(v);
  if (typeof x === 'number') {
    if (!Number.isFinite(x)) return undefined;
    return Math.abs(x - on) <= Math.abs(x - off) ? on : off;
  }
  const b = toBoolean(v);
  return b === undefined ? undefined : b ? on : off;
}

/**
 * How far an echoed number may be from what was sent and still be our own echo: half of its
 * last decimal place, but at least 0.1% of the range (devices often quantise, e.g. a mixer's
 * 1024 steps).
 */
export function rangeTolerance(p: { min: number; max: number; decimals: number }): number {
  return Math.max(stepOf(p.decimals) / 2, Math.abs(p.max - p.min) * 0.001);
}
