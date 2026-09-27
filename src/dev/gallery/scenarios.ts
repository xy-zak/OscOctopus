// Every widget in the states and sizes a skin has to cover, for the dev gallery and its
// screenshots (scripts/shots.mjs). A scenario is a widget at a fixed size with a value, and
// optionally a gesture the screenshot script performs with a real mouse before the shot
// (pressed, dragged, armed, …), then `freeze`: animations are paused that many ms in.
//
// Preview widgets are never on a desk, so `emitValue` ignores them: nothing is ever sent, and
// gestures show their pressed/dragging look without changing the value.
import type { Widget, WidgetType } from '../../lib/model/preset';
import type { WidgetValue } from '../../lib/osc/value';
import { newWidget } from '../../lib/widgets/defs';
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
}

function make<T extends WidgetType>(
  id: string,
  type: T,
  size: [number, number],
  tweak: (w: WidgetOf<T>) => void = () => {},
  rest: Omit<Scenario, 'id' | 'widget' | 'size'> = {},
): Scenario {
  const w = newWidget(type, { x: 0, y: 0, w: 1, h: 1 }, []);
  w.id = `preview-${id}`;
  tweak(w);
  return { id, widget: w, size, ...rest };
}

const CENTRE: Point = [0.5, 0.5];

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
];
