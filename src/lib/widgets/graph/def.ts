import type { Axis, GraphWidget } from '../../model/preset';
import { newBinding, valueArg } from '../../model/parts';
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
};
