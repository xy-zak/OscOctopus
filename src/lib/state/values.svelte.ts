// Live widget values (not saved in presets). Keyed by widget id; fine-grained reactive, so a
// fader move only re-renders what reads that fader's value.
import type { WidgetValue } from '../osc/value';

export const values: Record<string, WidgetValue> = $state({});

/** A single-value widget's current number (graphs never call this). */
export function numberValue(id: string, fallback: number): number {
  const v = values[id];
  return typeof v === 'number' ? v : fallback;
}
