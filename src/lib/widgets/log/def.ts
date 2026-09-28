// A log of what widgets sent and received, like their ACTIVITY in the Inspector but for several
// widgets at once and on the desk. It shows this device's own traffic: nothing of it is a
// value, nothing is sent or synced (it has no messages; its value never changes).
import type { LogWidget } from '../../model/preset';
import type { WidgetDef } from '../types';

const IDLE = 0;

export const logDef: WidgetDef<LogWidget> = {
  label: 'Log',
  readout: 'Rows shown / kept',
  defaultSize: { w: 6, h: 3 },
  create: (base, n) => ({
    ...base,
    type: 'log',
    label: `Log ${n}`,
    bindings: [],
    props: {
      follow: 'desk',
      sources: [],
      rows: 50,
      columns: ['time', 'dir', 'widget', 'address', 'value'],
    },
  }),
  initialValue: () => IDLE,
  channels: () => [],
  gate: () => ({ kind: 'queue' }),
  input: () => null,
  echoTolerance: () => ({}),
  isValue: (_w, v): v is number => v === IDLE,
  messages: () => 'none',
  remapRefs: (w, ids) => {
    w.props.sources = w.props.sources.flatMap((id) => ids.get(id) ?? []);
  },
};
