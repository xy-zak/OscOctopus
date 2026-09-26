import type { SwitchWidget } from '../../model/preset';
import { newBinding, valueArg } from '../../model/parts';
import type { WidgetDef } from '../types';

export const switchDef: WidgetDef<SwitchWidget> = {
  label: 'Switch',
  defaultSize: { w: 2, h: 1 },
  create: (base, n, outputIds) => ({
    ...base,
    type: 'switch',
    label: `Switch ${n}`,
    bindings: [newBinding(`/octopus/switch/${n}`, outputIds, [valueArg('i')])],
    props: { onValue: 1, offValue: 0 },
  }),
  initialValue: (w) => w.props.offValue,
  channels: () => [],
  gate: () => ({ kind: 'queue' }),
};
