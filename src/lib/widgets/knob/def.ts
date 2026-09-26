import type { KnobWidget } from '../../model/preset';
import { newBinding } from '../../model/parts';
import type { WidgetDef } from '../types';

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
};
