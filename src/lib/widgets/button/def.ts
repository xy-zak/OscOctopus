import type { ButtonWidget } from '../../model/preset';
import { newBinding, valueArg } from '../../model/parts';
import { nearestOnOff } from '../../osc/coerce';
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
  // Shows the pressed state only: it never arms, fires or starts a hold. A bare message (no
  // value) means "fired" for a trigger button; a momentary one needs an explicit on or off.
  input: (w, patch) => {
    const { mode, onValue, offValue } = w.props;
    if (!('value' in patch)) return mode === 'trigger' ? onValue : null;
    return nearestOnOff(patch.value, onValue, offValue) ?? null;
  },
  echoTolerance: () => ({ value: 0 }),
  isValue: (w, v): v is number => v === w.props.onValue || v === w.props.offValue,
  show: (w, value, fx) => {
    if (
      (fx.origin === 'input' || fx.origin === 'peer') &&
      w.props.mode === 'trigger' &&
      value === w.props.onValue
    ) {
      fx.flash();
    }
  },
};
