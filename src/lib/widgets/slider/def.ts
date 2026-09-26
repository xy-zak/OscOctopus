import type { SliderWidget } from '../../model/preset';
import { newBinding } from '../../model/parts';
import type { WidgetDef } from '../types';

/** The widget type is `slider` (persisted in presets); the UI calls it a Fader. */
export const sliderDef: WidgetDef<SliderWidget> = {
  label: 'Fader',
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
};
