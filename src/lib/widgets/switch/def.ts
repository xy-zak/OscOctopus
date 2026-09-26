import type { SwitchWidget } from '../../model/preset';
import { newBinding, valueArg } from '../../model/parts';
import { nearestOnOff } from '../../osc/coerce';
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
  // Whichever of on/off the message means (numbers pick the nearer one).
  input: (w, patch) => nearestOnOff(patch.value, w.props.onValue, w.props.offValue) ?? null,
  echoTolerance: () => ({ value: 0 }),
  isValue: (w, v): v is number => v === w.props.onValue || v === w.props.offValue,
};
