// Interaction rules shared by the continuous widgets (fader, graph), so they all feel the
// same: double-tap to reset, Shift for fine control, the same keyboard steps and readouts.
import type { Axis } from '../model/preset';
import { stepOf } from '../osc/curves';

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

/**
 * One arrow-key press as a fraction of the range: 1%, or one unit of the last decimal place
 * when that is bigger (a 0..10 fader with 0 decimals moves by 1). Shift makes it ten times
 * bigger.
 */
export function keyStep(p: Pick<Axis, 'min' | 'max' | 'decimals'>, shift: boolean): number {
  const one = Math.max(0.01, stepOf(p.decimals) / Math.abs(p.max - p.min || 1));
  return one * (shift ? 10 : 1);
}

/**
 * Whether moving through the range is felt as ticks: when its decimals give it at most
 * MAX_TICKS values (a 0..127 fader with 0 decimals), not when it is nearly continuous.
 */
export const MAX_TICKS = 200;
export const ticks = (p: Pick<Axis, 'min' | 'max' | 'decimals'>) =>
  Math.abs(p.max - p.min) / stepOf(p.decimals) <= MAX_TICKS;
