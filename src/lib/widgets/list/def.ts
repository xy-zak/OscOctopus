import type { ListWidget } from '../../model/preset';
import { newBinding, valueArg } from '../../model/parts';
import { listValue } from '../../osc/value';
import { clamp } from '../../util';
import type { WidgetDef } from '../types';

export const listDef: WidgetDef<ListWidget> = {
  label: 'List',
  defaultSize: { w: 2, h: 3 },
  create: (base, n, outputIds) => ({
    ...base,
    type: 'list',
    label: `List ${n}`,
    bindings: [newBinding(`/octopus/list/${n}`, outputIds, [valueArg('i', 'index')])],
    props: {
      options: [
        { label: 'One', value: '1' },
        { label: 'Two', value: '2' },
        { label: 'Three', value: '3' },
      ],
      defaultIndex: 0,
      layout: 'auto',
    },
  }),
  initialValue: (w) =>
    listValue(w.props.options, clamp(w.props.defaultIndex, 0, w.props.options.length - 1)),
  channels: () => [
    { id: 'index', hint: 'option number, 0 = first' },
    { id: 'label', hint: 'option label (string)' },
    { id: 'value', hint: 'option value' },
  ],
  gate: () => ({ kind: 'queue' }),
};
