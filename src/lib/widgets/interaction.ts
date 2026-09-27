// Interaction rules shared by the continuous widgets (fader, graph), so they all feel the
// same: double-tap to reset, Shift for fine control, the same keyboard steps and readouts.
import type { Axis } from '../model/preset';

/** Two presses closer together than this are a double tap (reset to default). */
export const DOUBLE_TAP_MS = 300;
/** Drag multiplier while Shift is held: 5x finer control. */
export const FINE_DRAG = 0.2;

/** The drag multiplier for a pointer event: FINE_DRAG while Shift is held, else 1. */
export const dragScale = (e: { shiftKey: boolean }) => (e.shiftKey ? FINE_DRAG : 1);

/**
 * A double-tap detector. Call it on every press; it returns true on the second press within
 * DOUBLE_TAP_MS (and then starts over, so a triple tap is one double tap plus a press).
 */
export function doubleTap(now: () => number = () => performance.now()): () => boolean {
  let last = -Infinity;
  return () => {
    const t = now();
    const double = t - last < DOUBLE_TAP_MS;
    last = double ? -Infinity : t;
    return double;
  };
}

/** Decimals worth showing for a value on `step`'s grid (0 = continuous: 3 decimals). */
export function decimalsFor(step: number): number {
  if (step >= 1) return 0;
  if (step > 0) return Math.min(4, String(step).split('.')[1]?.length ?? 0);
  return 3;
}

/** Decimals of a number as written, capped at 4 (e.g. an encoder value off the step grid). */
export function decimalsOf(n: number): number {
  return Math.min(4, String(n).split('.')[1]?.length ?? 0);
}

/**
 * One arrow-key step as a fraction of the range: one `step` if the widget has one, else 1%.
 * Shift makes it ten times bigger.
 */
export function keyStep(p: Pick<Axis, 'min' | 'max' | 'step'>, shift: boolean): number {
  const one = p.step > 0 ? p.step / Math.abs(p.max - p.min || 1) : 0.01;
  return one * (shift ? 10 : 1);
}
