// Constructors for new objects with sensible, visible defaults.
import type { InputConfig, OutputConfig } from '../ipc/types';
import {
  CURRENT_SCHEMA_VERSION,
  type Axis,
  type Binding,
  type ButtonWidget,
  type GraphWidget,
  type KnobWidget,
  type ListWidget,
  type PadsWidget,
  type Preset,
  type SliderWidget,
  type SwitchWidget,
  type Widget,
  type WidgetType,
} from './preset';

/** Short random id, valid for IdSchema. */
export function uid(prefix = ''): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const s = Array.from(bytes, (b) => b.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 10);
  return prefix ? `${prefix}-${s}` : s;
}

export function newOutput(overrides: Partial<OutputConfig> = {}): OutputConfig {
  return {
    id: uid('out'),
    name: 'New output',
    enabled: true,
    transport: 'udp',
    host: '127.0.0.1',
    port: 9000,
    mode: 'unicast',
    bindAddress: '0.0.0.0',
    localPort: 0,
    multicastTtl: 1,
    multicastLoop: true,
    framing: 'slip',
    reconnectMs: 1000,
    ...overrides,
  };
}

export function newInput(overrides: Partial<InputConfig> = {}): InputConfig {
  return {
    id: uid('in'),
    name: 'New input',
    enabled: true,
    transport: 'udp',
    bindAddress: '0.0.0.0',
    port: 9001,
    multicastGroup: null,
    framing: 'slip',
    ...overrides,
  };
}

export function newBinding(address: string, outputIds: string[]): Binding {
  return {
    id: uid('b'),
    enabled: true,
    outputIds,
    address,
    args: [{ kind: 'value', type: 'f' }],
  };
}

export function newWidget(
  type: WidgetType,
  rect: { x: number; y: number; w: number; h: number },
  outputIds: string[],
  n = 1,
): Widget {
  const base = { id: uid('w'), ...rect, color: null };
  const intArg = [{ kind: 'value' as const, type: 'i' as const }];
  switch (type) {
    case 'button':
      return {
        ...base,
        type: 'button',
        label: `Button ${n}`,
        bindings: [{ ...newBinding(`/octopus/button/${n}`, outputIds), args: intArg }],
        props: {
          mode: 'momentary',
          onValue: 1,
          offValue: 0,
          arm: 'none',
          armTimeoutMs: 3000,
          holdMs: 800,
        },
      } satisfies ButtonWidget;
    case 'switch':
      return {
        ...base,
        type: 'switch',
        label: `Switch ${n}`,
        bindings: [{ ...newBinding(`/octopus/switch/${n}`, outputIds), args: intArg }],
        props: { onValue: 1, offValue: 0 },
      } satisfies SwitchWidget;
    case 'slider':
      return {
        ...base,
        type: 'slider',
        label: `Fader ${n}`,
        bindings: [newBinding(`/octopus/fader/${n}`, outputIds)],
        props: {
          orientation: rect.h >= rect.w ? 'vertical' : 'horizontal',
          min: 0,
          max: 1,
          step: 0,
          curve: 'linear',
          touch: 'relative',
          defaultValue: 0,
          maxRateHz: 60,
        },
      } satisfies SliderWidget;
    case 'graph': {
      const axis = (label: string): Axis => ({
        label,
        min: 0,
        max: 1,
        step: 0,
        curve: 'linear',
        defaultValue: 0.5,
      });
      // One message per axis by default; a single `,ff x y` message is one click away.
      const perAxis = (c: 'x' | 'y') => ({
        ...newBinding(`/octopus/graph/${n}/${c}`, outputIds),
        args: [{ kind: 'value' as const, type: 'f' as const, channel: c }],
      });
      return {
        ...base,
        type: 'graph',
        label: `Graph ${n}`,
        bindings: [perAxis('x'), perAxis('y')],
        props: { x: axis('X'), y: axis('Y'), touch: 'absolute', trail: true, maxRateHz: 60 },
      } satisfies GraphWidget;
    }
    case 'knob':
      return {
        ...base,
        type: 'knob',
        label: `Knob ${n}`,
        bindings: [newBinding(`/octopus/knob/${n}`, outputIds)],
        props: {
          mode: 'bounded',
          min: 0,
          max: 1,
          step: 0,
          curve: 'linear',
          defaultValue: 0,
          deltaStep: 1,
          detentPx: 12,
          maxRateHz: 60,
        },
      } satisfies KnobWidget;
    case 'pads':
      // One message per hit: which pad, and whether it went on or off.
      return {
        ...base,
        type: 'pads',
        label: `Pads ${n}`,
        bindings: [
          {
            ...newBinding(`/octopus/pads/${n}`, outputIds),
            args: [
              { kind: 'value', type: 'i', channel: 'number' },
              { kind: 'value', type: 'i', channel: 'on' },
            ],
          },
        ],
        props: { rows: 4, cols: 4, mode: 'momentary' },
      } satisfies PadsWidget;
    case 'list':
      return {
        ...base,
        type: 'list',
        label: `List ${n}`,
        bindings: [
          {
            ...newBinding(`/octopus/list/${n}`, outputIds),
            args: [{ kind: 'value', type: 'i', channel: 'index' }],
          },
        ],
        props: {
          options: [
            { label: 'One', value: '1' },
            { label: 'Two', value: '2' },
            { label: 'Three', value: '3' },
          ],
          defaultIndex: 0,
          layout: 'auto',
        },
      } satisfies ListWidget;
  }
}

export const DEFAULT_SIZE: Record<WidgetType, { w: number; h: number }> = {
  button: { w: 2, h: 2 },
  switch: { w: 2, h: 1 },
  slider: { w: 1, h: 4 },
  knob: { w: 2, h: 2 },
  graph: { w: 4, h: 4 },
  pads: { w: 4, h: 4 },
  list: { w: 2, h: 3 },
};

/**
 * First-run preset: one loopback output and a loopback input on the same port, so the Debug
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
    // Row 1, under the EDIT / LIVE switch in the top-right cells.
    [newWidget('graph', { x: 8, y: 1, w: 4, h: 5 }, o, 1), 5],
  ];
  const widgets = layout.map(([w, color]) => ({ ...w, color }));
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    color: opts.color ?? 5,
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
 * A copy of a preset with new widget and binding ids. Live values and throttles are keyed by
 * widget id, so two open desks must never share one (e.g. a duplicated or re-imported desk).
 * Endpoint ids are kept: they are namespaced per desk by the network core.
 */
export function withFreshWidgetIds(preset: Preset): Preset {
  const copy = structuredClone(preset);
  for (const w of copy.widgets) {
    w.id = uid('w');
    for (const b of w.bindings) b.id = uid('b');
  }
  return copy;
}
