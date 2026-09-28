import type { Axis, GraphWidget } from '../../model/preset';
import { newBinding, valueArg } from '../../model/parts';
import { clampTo, hasExactKeys, isNumberIn, rangeTolerance, toNumber } from '../../osc/coerce';
import { isRecord, type WidgetValue } from '../../osc/value';
import type { WidgetDef } from '../types';

const axis = (label: string): Axis => ({
  label,
  min: 0,
  max: 1,
  step: 0,
  curve: 'linear',
  defaultValue: 0.5,
});

export const graphDef: WidgetDef<GraphWidget> = {
  label: 'Graph',
  readout: 'x and y',
  defaultSize: { w: 4, h: 4 },
  create: (base, n, outputIds) => ({
    ...base,
    type: 'graph',
    label: `Graph ${n}`,
    // One message per axis by default; a single `,ff x y` message is one click away.
    bindings: (['x', 'y'] as const).map((c) =>
      newBinding(`/octopus/graph/${n}/${c}`, outputIds, [valueArg('f', c)]),
    ),
    props: { x: axis('X'), y: axis('Y'), touch: 'absolute', trail: true, maxRateHz: 60 },
  }),
  initialValue: (w) => ({ x: w.props.x.defaultValue, y: w.props.y.defaultValue }),
  channels: () => [
    { id: 'x', hint: 'X position' },
    { id: 'y', hint: 'Y position' },
  ],
  gate: (w) => ({ kind: 'throttle', maxHz: w.props.maxRateHz }),
  // Sets whichever axes the message carries (the default setup has one message per axis).
  input: (w, patch, current) => {
    const x = toNumber(patch.x);
    const y = toNumber(patch.y);
    if (x === undefined && y === undefined) return null;
    const { x: ax, y: ay } = w.props;
    const now = isRecord(current) ? current : {};
    const keep = (v: unknown, a: Axis) => (typeof v === 'number' ? v : a.defaultValue);
    return {
      x: x === undefined ? keep(now.x, ax) : clampTo(x, ax.min, ax.max),
      y: y === undefined ? keep(now.y, ay) : clampTo(y, ay.min, ay.max),
    };
  },
  echoTolerance: (w) => ({ x: rangeTolerance(w.props.x), y: rangeTolerance(w.props.y) }),
  isValue: (w, v): v is WidgetValue =>
    hasExactKeys(v, ['x', 'y']) &&
    isNumberIn(v.x, w.props.x.min, w.props.x.max) &&
    isNumberIn(v.y, w.props.y.min, w.props.y.max),
};
