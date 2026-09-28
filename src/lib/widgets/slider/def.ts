import type { SliderWidget } from '../../model/preset';
import { newBinding } from '../../model/parts';
import { clampTo, isNumberIn, rangeTolerance, toNumber } from '../../osc/coerce';
import type { WidgetDef } from '../types';

/** The widget type is `slider` (persisted in presets); the UI calls it a Fader. */
export const sliderDef: WidgetDef<SliderWidget> = {
  label: 'Fader',
  readout: 'The value',
  defaultSize: { w: 1, h: 4 },
  create: (base, n, outputIds) => ({
    ...base,
    type: 'slider',
    label: `Fader ${n}`,
    bindings: [newBinding(`/octopus/fader/${n}`, outputIds)],
    props: {
      orientation: base.h >= base.w ? 'vertical' : 'horizontal',
      min: 0,
      max: 1,
      step: 0,
      curve: 'linear',
      touch: 'relative',
      defaultValue: 0,
      maxRateHz: 60,
    },
  }),
  initialValue: (w) => w.props.defaultValue,
  channels: () => [],
  gate: (w) => ({ kind: 'throttle', maxHz: w.props.maxRateHz }),
  // Clamped to the range, but not snapped to the step: the device is the truth.
  input: (w, patch) => {
    const v = toNumber(patch.value);
    return v === undefined ? null : clampTo(v, w.props.min, w.props.max);
  },
  echoTolerance: (w) => ({ value: rangeTolerance(w.props) }),
  isValue: (w, v): v is number => isNumberIn(v, w.props.min, w.props.max),
};
