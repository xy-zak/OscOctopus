import type { PadsWidget } from '../../model/preset';
import { newBinding, valueArg } from '../../model/parts';
import { padEvent } from '../../osc/value';
import type { WidgetDef } from '../types';

export const padsDef: WidgetDef<PadsWidget> = {
  label: 'Pads',
  defaultSize: { w: 4, h: 4 },
  // One message per hit: which pad, and whether it went on or off.
  create: (base, n, outputIds) => ({
    ...base,
    type: 'pads',
    label: `Pads ${n}`,
    bindings: [
      newBinding(`/octopus/pads/${n}`, outputIds, [valueArg('i', 'number'), valueArg('i', 'on')]),
    ],
    props: { rows: 4, cols: 4, mode: 'momentary' },
  }),
  initialValue: (w) => padEvent(w.props, 1, 1, false),
  channels: () => [
    { id: 'number', hint: 'pad number, 1 = top-left' },
    { id: 'row', hint: 'row, 1 = top' },
    { id: 'col', hint: 'column, 1 = left' },
    { id: 'on', hint: 'true on hit, false on release' },
  ],
  // Fast rolls must never lose a hit.
  gate: () => ({ kind: 'queue' }),
};
