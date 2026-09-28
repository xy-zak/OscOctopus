import type { PadsWidget } from '../../model/preset';
import { newBinding, valueArg } from '../../model/parts';
import { canonical } from '../../canonical';
import { hasExactKeys, toBoolean, toInteger } from '../../osc/coerce';
import { isRecord, padEvent, type WidgetValue } from '../../osc/value';
import type { WidgetDef } from '../types';

export const padsDef: WidgetDef<PadsWidget> = {
  label: 'Pads',
  readout: 'Rows × columns',
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
  // Which pad: `number`, or `row` + `col`. A message without `on` is a hit. Toggle pads are
  // *set* on or off (never flipped), so repeated messages agree.
  input: (w, patch) => {
    const { rows, cols } = w.props;
    let number = toInteger(patch.number);
    if (number === undefined) {
      const row = toInteger(patch.row);
      const col = toInteger(patch.col);
      if (row === undefined || col === undefined) return null;
      if (row < 1 || row > rows || col < 1 || col > cols) return null;
      number = (row - 1) * cols + col;
    }
    if (number < 1 || number > rows * cols) return null;
    const on = 'on' in patch ? toBoolean(patch.on) : true;
    if (on === undefined) return null;
    return padEvent(w.props, Math.floor((number - 1) / cols) + 1, ((number - 1) % cols) + 1, on);
  },
  echoTolerance: () => ({ number: 0, on: 0 }),
  // A hit on a pad that exists, with number, row and col agreeing.
  isValue: (w, v): v is WidgetValue => {
    if (!hasExactKeys(v, ['number', 'row', 'col', 'on'])) return false;
    const { row, col, on } = v;
    const { rows, cols } = w.props;
    return (
      typeof on === 'boolean' &&
      Number.isInteger(row) &&
      Number.isInteger(col) &&
      (row as number) >= 1 &&
      (row as number) <= rows &&
      (col as number) >= 1 &&
      (col as number) <= cols &&
      canonical(v) === canonical(padEvent(w.props, row as number, col as number, on))
    );
  },
  show: (w, value, fx) => {
    if (!isRecord(value) || typeof value.number !== 'number') return;
    const on = value.on === true;
    if (w.props.mode !== 'trigger') fx.setPadLit(value.number, on);
    else if (on && (fx.origin === 'input' || fx.origin === 'peer')) fx.flashPad(value.number);
  },
  // Each pad is touched on its own: holding pad 3 doesn't block input to pad 7.
  touchKey: (w, value) =>
    isRecord(value) && typeof value.number === 'number' ? `${w.id}#${value.number}` : w.id,
};
