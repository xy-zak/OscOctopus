// A frame (type `tabs`): one place on the desk with one or more tabs, sharing one grid of its own
// (model/tabs.ts, docs/ARCHITECTURE.md › Frames). The widgets on its tabs are ordinary widgets of
// the desk, so the frame itself sends and receives nothing. Its value is the tab shown: this
// device's own view (`presetStore.showTab` writes it straight into `values`, never through
// osc/flow.ts), so it is never sent or shared.
import { uid } from '../../model/parts';
import { LIMITS, type Tab, type TabsWidget } from '../../model/preset';
import type { WidgetDef } from '../types';

/** A tab name as typed: trimmed and cut to the limit ('' when nothing is left). */
export const tabName = (text: string) => text.trim().slice(0, LIMITS.tabName.max);

/** A new, empty tab. */
export const newTab = (name: string): Tab => ({ id: uid('tb'), name });

/** Whether a frame has as many tabs as it may. */
export const tabsFull = (w: TabsWidget) => w.props.tabs.length >= LIMITS.tabs.max;

/** Why no other tab can be added (`tabsFull`). */
export const TOO_MANY_TABS = `A frame has at most ${LIMITS.tabs.max} tabs`;

/** The tab a value shows: the one it names, or the first if that tab is gone. */
export function shownTab(w: TabsWidget, value: unknown): Tab {
  return w.props.tabs.find((t) => t.id === value) ?? w.props.tabs[0]!;
}

export const tabsDef: WidgetDef<TabsWidget> = {
  label: 'Frame',
  readout: 'The tab shown',
  defaultSize: { w: 6, h: 4 },
  create: (base, n) => ({
    ...base,
    type: 'tabs',
    label: `Frame ${n}`,
    bindings: [],
    props: { grid: { cols: 6, rows: 4, gap: 6 }, tabs: [newTab('Tab 1')] },
  }),
  initialValue: (w) => w.props.tabs[0]!.id,
  channels: () => [],
  gate: () => ({ kind: 'queue' }),
  input: () => null,
  echoTolerance: () => ({}),
  isValue: (w, v): v is string => typeof v === 'string' && w.props.tabs.some((t) => t.id === v),
  valueText: (w, v) => shownTab(w, v).name,
  messages: () => 'none',
};
