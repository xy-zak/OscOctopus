import type { ButtonWidget } from '../../model/preset';
import { newBinding, valueArg } from '../../model/parts';
import type { WidgetDef } from '../types';

export const buttonDef: WidgetDef<ButtonWidget> = {
  label: 'Button',
  defaultSize: { w: 2, h: 2 },
  create: (base, n, outputIds) => ({
    ...base,
    type: 'button',
    label: `Button ${n}`,
    bindings: [newBinding(`/octopus/button/${n}`, outputIds, [valueArg('i')])],
    props: {
      mode: 'momentary',
      onValue: 1,
      offValue: 0,
      arm: 'none',
      armTimeoutMs: 3000,
      holdMs: 800,
    },
  }),
  initialValue: (w) => w.props.offValue,
  channels: () => [],
  // Every press and release is an event: never merged away.
  gate: () => ({ kind: 'queue' }),
};
