import type { ListOption, ListWidget } from '../../model/preset';
import { newBinding, valueArg } from '../../model/parts';
import { canonical } from '../../canonical';
import { hasExactKeys, toInteger, toNumber } from '../../osc/coerce';
import { isList, listValue, type Scalar, type ValueList, type WidgetValue } from '../../osc/value';
import { clamp } from '../../util';
import type { WidgetDef } from '../types';

const first = (v: Scalar | ValueList): Scalar | undefined => (isList(v) ? v[0] : v);

/** The option whose value matches: numerically if both look like numbers, else as text. */
function byValue(options: readonly ListOption[], v: Scalar): number {
  const n = toNumber(v);
  return options.findIndex((o) =>
    n !== undefined && toNumber(o.value) !== undefined
      ? toNumber(o.value) === n
      : o.value === String(v),
  );
}

/** Exact label, then with `_` read as a space (as addresses write it), then any case. */
function byLabel(options: readonly ListOption[], label: string): number {
  const spaced = label.replace(/_/g, ' ');
  const lower = spaced.toLowerCase();
  const exact = options.findIndex((o) => o.label === label);
  if (exact >= 0) return exact;
  const withSpaces = options.findIndex((o) => o.label === spaced);
  return withSpaces >= 0 ? withSpaces : options.findIndex((o) => o.label.toLowerCase() === lower);
}

export const listDef: WidgetDef<ListWidget> = {
  label: 'List',
  readout: 'Which option, e.g. 2/5',
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
  // Selects by index, else by value, else by label; no matching option → ignored.
  input: (w, patch) => {
    const options = w.props.options;
    const pick = (i: number) => (i >= 0 && i < options.length ? listValue(options, i) : null);
    if (patch.index !== undefined) {
      const i = toInteger(patch.index);
      return i === undefined ? null : pick(i);
    }
    const value = patch.value === undefined ? undefined : first(patch.value);
    if (value !== undefined) {
      const i = byValue(options, value);
      if (i >= 0) return pick(i);
    }
    const label = patch.label === undefined ? undefined : first(patch.label);
    return label === undefined ? null : pick(byLabel(options, String(label)));
  },
  echoTolerance: () => ({ index: 0 }),
  // One of the options, exactly as selecting it locally would give.
  isValue: (w, v): v is WidgetValue => {
    if (!hasExactKeys(v, ['index', 'label', 'value'])) return false;
    const i = v.index;
    return (
      Number.isInteger(i) &&
      (i as number) >= 0 &&
      (i as number) < w.props.options.length &&
      canonical(v) === canonical(listValue(w.props.options, i as number))
    );
  },
};
