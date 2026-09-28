// Every widget in the states and sizes a skin has to cover, for the dev gallery and its
// screenshots (scripts/shots.mjs). A scenario is a widget at a fixed size with a value, and
// optionally a gesture the screenshot script performs with a real mouse before the shot
// (pressed, dragged, armed, …), then `freeze`: animations are paused that many ms in.
//
// Preview widgets are never on a desk, so `emitValue` ignores them: nothing is ever sent, and
// gestures show their pressed/dragging look without changing the value.
import type { DebugEvent } from '../../lib/ipc/types';
import type { Widget, WidgetType } from '../../lib/model/preset';
import type { WidgetValue } from '../../lib/osc/value';
import { previewWidget } from '../../lib/skins/preview';
import { debugStore } from '../../lib/state/debug.svelte';
import { inputStore } from '../../lib/state/input.svelte';
import { sequencerStore, type SeqRun } from '../../lib/state/sequencer.svelte';
import { newStep } from '../../lib/widgets/sequencer/def';
import type { WidgetOf } from '../../lib/widgets/types';

/** A point inside the widget, as fractions of its box (0,0 top-left … 1,1 bottom-right). */
export type Point = [number, number];

export type Gesture =
  /** Press and keep holding. */
  | { kind: 'press'; at: Point }
  /** Press and release (arms a double-tap button, starts a release dissolve). */
  | { kind: 'tap'; at: Point }
  /** Press at the first point, move through the rest, keep holding. */
  | { kind: 'drag'; path: Point[] };

export interface Scenario {
  id: string;
  widget: Widget;
  /** Stage size in CSS px. */
  size: [number, number];
  value?: WidgetValue;
  /** Pads lit from outside (incoming OSC, a peer). */
  lit?: number[];
  gesture?: Gesture;
  /** Pause every animation this many ms after the gesture (default: let them finish). */
  freeze?: number;
  /** Seeds what the widget shows besides its value (a sequencer's run, a log's rows). */
  setup?: (w: Widget) => void;
}

function make<T extends WidgetType>(
  id: string,
  type: T,
  size: [number, number],
  tweak: (w: WidgetOf<T>) => void = () => {},
  rest: Omit<Scenario, 'id' | 'widget' | 'size'> = {},
): Scenario {
  const w = previewWidget(type, id);
  tweak(w);
  return { id, widget: w, size, ...rest };
}

const CENTRE: Point = [0.5, 0.5];

/**
 * Shows a sequencer as if its run were at `step` of `pass`, `waited` of the way through a 1 s
 * wait (previews never really run). Reported "in the future", so no time counts as passed and
 * the wait bar sits exactly there once the shot freezes its animation (`freeze: 0`).
 */
const running =
  (state: SeqRun['state'], step: number, pass: number, waited: number) =>
  (w: Widget): void => {
    sequencerStore.runs[w.id] = {
      desk: 'gallery',
      run: 1,
      state,
      step,
      pass,
      waitMs: 1000,
      leftMs: Math.round(1000 * (1 - waited)),
      atMicros: Number.MAX_SAFE_INTEGER,
      late: 0,
    };
  };

/** The widgets a log scenario follows, and what they sent and received at fixed times. */
const LOGGED = ['gallery-fader', 'gallery-cue'];
let logSeeded = false;
function seedLog(): void {
  if (logSeeded) return;
  logSeeded = true;
  const at = (s: number) => Date.UTC(2026, 8, 28, 12, 0, s) * 1000;
  const sent = (seq: number, s: number, over: Partial<DebugEvent>): DebugEvent => ({
    seq,
    tsMicros: at(s),
    kind: 'packet',
    direction: 'out',
    desk: 'gallery',
    endpointId: 'out-1',
    endpointName: 'Lights',
    transport: 'udp',
    local: null,
    remote: '192.168.1.40:9000',
    bytes: [],
    wireLen: 20,
    decoded: {
      kind: 'message',
      address: '/fader/1',
      typetags: ',f',
      args: [{ type: 'f', value: 0.62 }],
    },
    decodeError: null,
    error: null,
    message: null,
    source: LOGGED[0]!,
    blocked: false,
    origin: null,
    ...over,
  });
  debugStore.ingest({
    events: [
      sent(1, 1, {}),
      sent(2, 3, {
        source: LOGGED[1]!,
        decoded: {
          kind: 'message',
          address: '/cue/go',
          typetags: ',i',
          args: [{ type: 'i', value: 12 }],
        },
      }),
      sent(3, 5, { blocked: true, remote: null }),
      sent(4, 6, { source: LOGGED[1]!, error: 'network unreachable' }),
    ],
    dropped: 0,
    totalDropped: 0,
  });
  inputStore.record(new Map(), [
    {
      widgetId: LOGGED[0]!,
      result: 'applied',
      msg: {
        seq: 5,
        tsMicros: at(2),
        desk: 'gallery',
        endpointId: 'in-1',
        remote: '192.168.1.22:8000',
        address: '/fader/1',
        args: [{ type: 'f', value: 0.4 }],
      },
    },
    {
      widgetId: LOGGED[1]!,
      result: 'touched',
      msg: {
        seq: 6,
        tsMicros: at(4),
        desk: 'gallery',
        endpointId: 'in-1',
        remote: '192.168.1.22:8000',
        address: '/cue/go',
        args: [{ type: 'i', value: 11 }],
      },
    },
  ]);
}

export const SCENARIOS: Scenario[] = [
  // Button: rest, pressed, lit from outside, armed, holding, release dissolve, sizes.
  make('button-rest', 'button', [150, 150], (w) => (w.color = 1)),
  make('button-auto-colour', 'button', [150, 150]),
  make('button-pressed', 'button', [150, 150], (w) => (w.color = 1), {
    gesture: { kind: 'press', at: CENTRE },
  }),
  make('button-remote-on', 'button', [150, 150], (w) => (w.color = 1), { value: 1 }),
  make(
    'button-armed',
    'button',
    [220, 150],
    (w) => {
      w.color = 8;
      w.props.arm = 'double';
    },
    { gesture: { kind: 'tap', at: CENTRE }, freeze: 0 },
  ),
  make(
    'button-holding',
    'button',
    [150, 150],
    (w) => {
      w.color = 8;
      w.props.arm = 'hold';
      w.props.holdMs = 1000;
    },
    { gesture: { kind: 'press', at: CENTRE }, freeze: 500 },
  ),
  make('button-dissolve', 'button', [150, 150], (w) => (w.color = 1), {
    gesture: { kind: 'tap', at: CENTRE },
    freeze: 100,
  }),
  make('button-small', 'button', [70, 70], (w) => (w.color = 4)),
  make('button-tiny', 'button', [36, 36], (w) => (w.color = 4)),
  make('button-long-label', 'button', [90, 220], (w) => {
    w.color = 6;
    w.label = 'Scene change cue';
  }),

  // Switch: off, on, pressed, mid-drag, vertical, small.
  make('switch-off', 'switch', [140, 64], (w) => (w.color = 3)),
  make('switch-on', 'switch', [140, 64], (w) => (w.color = 3), { value: 1 }),
  make('switch-pressed', 'switch', [140, 64], (w) => (w.color = 3), {
    gesture: { kind: 'press', at: [0.3, 0.5] },
  }),
  make('switch-dragging', 'switch', [140, 64], (w) => (w.color = 3), {
    gesture: {
      kind: 'drag',
      path: [
        [0.3, 0.5],
        [0.45, 0.5],
        [0.55, 0.5],
      ],
    },
  }),
  make('switch-vertical-on', 'switch', [64, 140], (w) => (w.color = 3), { value: 1 }),
  make('switch-small', 'switch', [70, 40], (w) => (w.color = 3)),

  // Fader: vertical and horizontal, empty/mid/full, dragging, small.
  make('fader-vertical', 'slider', [64, 260], (w) => (w.color = 0), { value: 0.3 }),
  make('fader-vertical-dragging', 'slider', [64, 260], (w) => (w.color = 0), {
    value: 0.6,
    gesture: { kind: 'press', at: [0.5, 0.4] },
  }),
  make(
    'fader-horizontal',
    'slider',
    [260, 64],
    (w) => {
      w.color = 6;
      w.props.orientation = 'horizontal';
    },
    { value: 0.7 },
  ),
  make(
    'fader-horizontal-full',
    'slider',
    [260, 64],
    (w) => {
      w.color = 6;
      w.props.orientation = 'horizontal';
    },
    { value: 1 },
  ),
  make('fader-empty', 'slider', [64, 200], (w) => (w.color = 0), { value: 0 }),
  make('fader-small', 'slider', [40, 120], (w) => (w.color = 0), { value: 0.5 }),

  // Graph: rest, dragged with a trail, small, wide.
  make('graph-rest', 'graph', [240, 240], (w) => (w.color = 5), { value: { x: 0.3, y: 0.7 } }),
  make('graph-dragging', 'graph', [240, 240], (w) => (w.color = 5), {
    value: { x: 0.5, y: 0.5 },
    gesture: {
      kind: 'drag',
      path: [
        [0.5, 0.5],
        [0.55, 0.45],
        [0.6, 0.4],
        [0.65, 0.38],
        [0.7, 0.36],
      ],
    },
  }),
  make('graph-small', 'graph', [120, 120], (w) => (w.color = 5)),
  make('graph-wide', 'graph', [360, 180], (w) => (w.color = 7), { value: { x: 0.8, y: 0.2 } }),

  // Pads: rest, lit from outside, pressed, release dissolve, sizes.
  make('pads-rest', 'pads', [240, 240], (w) => (w.color = 2)),
  make('pads-lit', 'pads', [240, 240], (w) => (w.color = 2), { lit: [1, 6, 11, 16] }),
  make('pads-pressed', 'pads', [240, 240], (w) => (w.color = 2), {
    gesture: { kind: 'press', at: [0.375, 0.375] },
  }),
  make('pads-dissolve', 'pads', [240, 240], (w) => (w.color = 2), {
    gesture: { kind: 'tap', at: [0.125, 0.125] },
    freeze: 100,
  }),
  make(
    'pads-8x8',
    'pads',
    [300, 300],
    (w) => {
      w.color = 9;
      w.props.rows = 8;
      w.props.cols = 8;
    },
    { lit: [10, 28, 37] },
  ),
  make(
    'pads-2x2-small',
    'pads',
    [100, 100],
    (w) => {
      w.color = 9;
      w.props.rows = 2;
      w.props.cols = 2;
    },
    { lit: [4] },
  ),

  // List: vertical, pressed, horizontal, scrolling, release dissolve.
  make('list-vertical', 'list', [160, 200], (w) => (w.color = 4), {
    value: { index: 1, label: 'Two', value: 2 },
  }),
  make('list-pressed', 'list', [160, 200], (w) => (w.color = 4), {
    gesture: { kind: 'press', at: [0.5, 0.2] },
  }),
  make('list-horizontal', 'list', [360, 64], (w) => (w.color = 4), {
    value: { index: 2, label: 'Three', value: 3 },
  }),
  make(
    'list-scrolling',
    'list',
    [160, 110],
    (w) => {
      w.color = 7;
      w.props.options = Array.from({ length: 9 }, (_, i) => ({
        label: `Scene ${i + 1}`,
        value: String(i + 1),
      }));
    },
    { value: { index: 0, label: 'Scene 1', value: 1 } },
  ),
  make('list-dissolve', 'list', [160, 200], (w) => (w.color = 4), {
    gesture: { kind: 'tap', at: [0.5, 0.1] },
    freeze: 100,
  }),

  // Sequencer: stopped, running at a step, paused, a key pressed, many steps in a narrow one.
  make('seq-stopped', 'sequencer', [240, 120], (w) => (w.color = 6)),
  make('seq-running', 'sequencer', [240, 120], (w) => (w.color = 6), {
    setup: running('running', 2, 3, 0.4),
    freeze: 0,
  }),
  make('seq-paused', 'sequencer', [240, 120], (w) => (w.color = 6), {
    setup: running('paused', 1, 1, 0.7),
    freeze: 0,
  }),
  make('seq-pressed', 'sequencer', [240, 120], (w) => (w.color = 6), {
    gesture: { kind: 'press', at: [0.28, 0.4] },
  }),
  make(
    'seq-many-steps',
    'sequencer',
    [150, 100],
    (w) => {
      w.color = 1;
      w.props.steps = Array.from({ length: 16 }, (_, i) => newStep('/beat', i + 1, 125));
      w.props.repeat = 'count';
      w.props.count = 4;
    },
    { setup: running('running', 9, 2, 0.25), freeze: 0 },
  ),

  // Text: each size, the marks in light and dark, alignment, and received text.
  make('text-sizes', 'text', [360, 220], (w) => {
    w.color = 3;
    w.props.size = 's';
    w.props.source = 'Small, the app’s size\n**Bold** and ==reverse==';
  }),
  ...(['m', 'l', 'xl'] as const).map((size) =>
    make(`text-${size}`, 'text', [360, 140], (w) => {
      w.color = 3;
      w.props.size = size;
      w.props.source = `${size.toUpperCase()} text`;
    }),
  ),
  make('text-marks', 'text', [360, 200], (w) => {
    w.color = 8;
    w.props.size = 's';
    w.props.source =
      '# Heading line\n- a list item\n- **bold**, ==reverse==, {3:colour} and =={6:both}==\n\nafter a gap';
  }),
  make('text-centred', 'text', [300, 160], (w) => {
    w.color = 0;
    w.props.align = 'center';
    w.props.valign = 'middle';
    w.props.source = '# Act 2\nScene 3';
  }),
  make(
    'text-osc',
    'text',
    [300, 120],
    (w) => {
      w.color = 5;
      w.props.mode = 'osc';
      w.props.size = 'l';
      w.props.source = 'Now: **{value}**';
    },
    { value: 'Chorus' },
  ),

  // Log: sent, received, held and failed rows at fixed times; no rows yet.
  make(
    'log-rows',
    'log',
    [520, 200],
    (w) => {
      w.color = 7;
      w.props.follow = 'chosen';
      w.props.sources = [...LOGGED];
      w.props.columns = ['time', 'dir', 'widget', 'address', 'value', 'endpoint', 'ip', 'result'];
    },
    { setup: seedLog },
  ),
  make('log-empty', 'log', [320, 120], (w) => (w.color = 7)),
];
