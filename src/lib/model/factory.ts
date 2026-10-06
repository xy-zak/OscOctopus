// Constructors for new endpoints and presets with sensible, visible defaults. (Widgets are
// created by their defs: `newWidget` in widgets/defs.ts.)
import { INPUT_DEFAULTS, OUTPUT_DEFAULTS } from '../ipc/defaults';
import type { InputConfig, OutputConfig } from '../ipc/types';
import { DEFAULT_COLOR } from '../theme/palettes';
import { newWidget, remapRefsOf } from '../widgets/defs';
import { uid } from './parts';
import { CURRENT_SCHEMA_VERSION, type Preset, type Widget } from './preset';

export function newOutput(overrides: Partial<OutputConfig> = {}): OutputConfig {
  return { ...OUTPUT_DEFAULTS, id: uid('out'), name: 'New output', ...overrides };
}

export function newInput(overrides: Partial<InputConfig> = {}): InputConfig {
  return { ...INPUT_DEFAULTS, id: uid('in'), name: 'New input', ...overrides };
}

/**
 * First-run preset: one loopback output and a loopback input on the same port, so the Traffic
 * view immediately shows each packet leaving and arriving. Nothing listens on the LAN.
 * Extra desks pass `loopbackInput: false`: a second listener on the same port would only
 * fail to bind.
 */
export function newPreset(
  name = 'My desk',
  opts: { loopbackInput?: boolean; color?: number } = {},
): Preset {
  const now = new Date().toISOString();
  const out = newOutput({ name: 'Loopback 9000', host: '127.0.0.1', port: 9000 });
  const input = newInput({ name: 'Loopback monitor 9000', bindAddress: '127.0.0.1', port: 9000 });
  const o = [out.id];
  // [widget, palette colour]: a spread of colours so the palette is visible straight away.
  const layout: [Widget, number][] = [
    [newWidget('slider', { x: 0, y: 0, w: 1, h: 6 }, o, 1), 0],
    [newWidget('slider', { x: 1, y: 0, w: 1, h: 6 }, o, 2), 2],
    [newWidget('slider', { x: 2, y: 0, w: 1, h: 6 }, o, 3), 4],
    [newWidget('button', { x: 4, y: 0, w: 2, h: 2 }, o, 1), 8],
    [newWidget('switch', { x: 6, y: 0, w: 2, h: 1 }, o, 1), 3],
    [newWidget('slider', { x: 4, y: 3, w: 4, h: 1 }, o, 4), 6],
    [newWidget('graph', { x: 8, y: 0, w: 4, h: 5 }, o, 1), 5],
  ];
  const widgets = layout.map(([w, color]) => ({ ...w, color }));
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    color: opts.color ?? DEFAULT_COLOR,
    id: uid('p'),
    name,
    createdAt: now,
    updatedAt: now,
    grid: { cols: 12, rows: 8, gap: 10 },
    network: { outputs: [out], inputs: opts.loopbackInput === false ? [] : [input] },
    widgets,
  };
}

/**
 * Copies of widgets (plain objects, not state) with new widget and binding ids. What refers to
 * one of them follows it to its new id: a widget on a copied frame's tab (`parent`), a text
 * monitor's target, a log's sources. A reference to one of `outside` (widgets that stay where
 * they are) is kept; one to any other widget is dropped. A `parent` outside the copies is left
 * as it is, for the caller to place.
 */
export function freshCopies(
  widgets: readonly Widget[],
  outside: Iterable<string> = [],
): { widgets: Widget[]; ids: Map<string, string> } {
  const copies = structuredClone(widgets) as Widget[];
  const ids = new Map<string, string>();
  for (const w of copies) {
    const id = uid('w');
    ids.set(w.id, id);
    w.id = id;
    for (const b of w.bindings) b.id = uid('b');
  }
  const refs = new Map(ids);
  for (const id of outside) if (!refs.has(id)) refs.set(id, id);
  for (const w of copies) {
    const host = w.parent && ids.get(w.parent.widget);
    if (w.parent && host) w.parent = { ...w.parent, widget: host };
    remapRefsOf(w, refs);
  }
  return { widgets: copies, ids };
}

/**
 * A copy of a preset with new widget and binding ids. Live values and throttles are keyed by
 * widget id, so two open desks must never share one (e.g. a duplicated or re-imported desk).
 * Widgets that refer to others of the desk (a frame's widgets, a text monitor, a log)
 * follow them to their new ids. Endpoint ids are kept: they are namespaced per desk by the
 * network core.
 */
export function withFreshWidgetIds(preset: Preset): Preset {
  const copy = structuredClone(preset);
  copy.widgets = freshCopies(copy.widgets).widgets;
  return copy;
}
