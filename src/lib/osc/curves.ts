// Fader curves: a normalised 0..1 position ⇄ a value in [min, max]. Pure; tested in
// mapping.test.ts. Shared by the fader and both graph axes.
import type { Axis } from '../model/preset';
import { clamp } from '../util';

type Curve = Axis['curve'];

const K = 4; // curvature of the exp/log curves

/** Shapes a normalised 0..1 position. `exp` gives finer control at the low end. */
export function shape(n: number, curve: Curve): number {
  n = clamp(n, 0, 1);
  switch (curve) {
    case 'exp':
      return (Math.exp(K * n) - 1) / (Math.exp(K) - 1);
    case 'log':
      return Math.log1p((Math.exp(K) - 1) * n) / K;
    default:
      return n;
  }
}

/** Inverse of `shape`. */
export function unshape(v: number, curve: Curve): number {
  v = clamp(v, 0, 1);
  switch (curve) {
    case 'exp':
      return Math.log1p((Math.exp(K) - 1) * v) / K;
    case 'log':
      return (Math.exp(K * v) - 1) / (Math.exp(K) - 1);
    default:
      return v;
  }
}

/** The smallest change a number with `decimals` places can make: 0 → 1, 2 → 0.01. */
export const stepOf = (decimals: number) => 10 ** -decimals;

/** Position (0..1) → output value in [min, max], rounded to `decimals` places. */
export function sliderValue(
  n: number,
  p: Pick<Axis, 'min' | 'max' | 'decimals' | 'curve'>,
): number {
  const raw = p.min + (p.max - p.min) * shape(n, p.curve);
  const lo = Math.min(p.min, p.max);
  const hi = Math.max(p.min, p.max);
  return clamp(Number(raw.toFixed(p.decimals)), lo, hi);
}

/** Output value → position (0..1). */
export function sliderPosition(v: number, p: Pick<Axis, 'min' | 'max' | 'curve'>): number {
  if (p.max === p.min) return 0;
  return unshape((v - p.min) / (p.max - p.min), p.curve);
}
