import type { KnobWidget } from '../../model/preset';
import { newBinding } from '../../model/parts';
import { clampTo, hasExactKeys, isNumberIn, rangeTolerance, toNumber } from '../../osc/coerce';
import { isRecord, type WidgetValue } from '../../osc/value';
import type { WidgetDef } from '../types';

const round10 = (n: number) => Number(n.toFixed(10));

export const knobDef: WidgetDef<KnobWidget> = {
  label: 'Knob',
  defaultSize: { w: 2, h: 2 },
  create: (base, n, outputIds) => ({
    ...base,
    type: 'knob',
    label: `Knob ${n}`,
    bindings: [newBinding(`/octopus/knob/${n}`, outputIds)],
    props: {
      mode: 'bounded',
      min: 0,
      max: 1,
      step: 0,
      curve: 'linear',
      defaultValue: 0,
      deltaStep: 1,
      detentPx: 12,
      maxRateHz: 60,
    },
  }),
  initialValue: (w) =>
    w.props.mode === 'endless' ? { value: w.props.defaultValue, delta: 0 } : w.props.defaultValue,
  channels: (w) =>
    w.props.mode === 'endless'
      ? [
          { id: 'value', hint: 'accumulated value' },
          { id: 'delta', hint: 'change per detent (±step)' },
        ]
      : [],
  // An encoder's held-back deltas add up instead of being dropped.
  gate: (w) => ({
    kind: w.props.mode === 'endless' ? 'merge' : 'throttle',
    maxHz: w.props.maxRateHz,
  }),
  // Bounded: like a fader. Endless: an absolute `value` sets it (the delta is the real change,
  // so the trail points the right way); a bare `delta` turns it.
  input: (w, patch, current) => {
    const p = w.props;
    if (p.mode === 'bounded') {
      const v = toNumber(patch.value);
      return v === undefined ? null : clampTo(v, p.min, p.max);
    }
    const now = isRecord(current) && typeof current.value === 'number' ? current.value : 0;
    const value = toNumber(patch.value);
    if (value !== undefined) return { value, delta: round10(value - now) };
    const delta = toNumber(patch.delta);
    return delta === undefined ? null : { value: round10(now + delta), delta };
  },
  echoTolerance: (w) =>
    w.props.mode === 'endless'
      ? { value: Math.abs(w.props.deltaStep) / 2 }
      : { value: rangeTolerance(w.props) },
  isValue: (w, v): v is WidgetValue =>
    w.props.mode === 'bounded'
      ? isNumberIn(v, w.props.min, w.props.max)
      : hasExactKeys(v, ['value', 'delta']) &&
        isNumberIn(v.value, -Number.MAX_VALUE, Number.MAX_VALUE) &&
        isNumberIn(v.delta, -Number.MAX_VALUE, Number.MAX_VALUE),
};
