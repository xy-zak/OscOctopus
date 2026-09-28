// The anatomy of every widget: the named visual parts a skin can style, the states they show,
// and the geometry tokens a skin can set. Components mark each part with `data-part="<name>"`
// and each state with a `data-<state>` attribute, and keep only structural CSS (position,
// layout, geometry read from the tokens below); every colour, border, shadow, texture and
// animation lives in a skin stylesheet (skins/terminal.css, …). anatomy.test.ts holds the
// components to that, and the skins to what every skin shares (docs/SKINS.md): the font, where
// titles and values go, the markers, and the plain desk background.
//
// Where a state attribute sits:
//   frame  on the widget's root (.frame): the whole widget is on, dragged, vertical, …
//   self   on the part itself: this pad is lit, this option is the current one, …
//   key    on the enclosing keycap (Button's key, a pad's key)

export const STATES = [
  'live',
  'active',
  'pressed',
  'lifted',
  'on',
  'lit',
  'armed',
  'holding',
  'dragging',
  'vertical',
  'horizontal',
  'down',
  'current',
  'held',
  'flash',
  'fading',
] as const;
export type State = (typeof STATES)[number];

export type StateScope = 'frame' | 'self' | 'key';

/**
 * What an image can do on a part (user skins, schema.ts):
 *   region  a surface that stretches: nine-slice, stretch, cover, contain or tile
 *   glyph   a small mark kept in proportion: contain
 *   line    a stroke along one axis: tile or stretch
 *   none    paint only
 */
export type ImageKind = 'region' | 'glyph' | 'line' | 'none';

export interface Part {
  label: string;
  states: Partial<Record<State, StateScope>>;
  image: ImageKind;
}

const FRAME_STATES = { active: 'frame', pressed: 'frame', lifted: 'frame' } as const;

export const PARTS = {
  frame: { label: 'Frame', states: { ...FRAME_STATES, live: 'frame' }, image: 'region' },
  'frame.body': { label: 'Frame inside', states: {}, image: 'none' },
  'frame.title': { label: 'Title', states: { active: 'frame' }, image: 'none' },
  'frame.status': { label: 'Value readout', states: { active: 'frame' }, image: 'none' },

  keycap: { label: 'Key', states: { down: 'key' }, image: 'region' },
  'keycap.wall': { label: 'Key sides', states: { down: 'key' }, image: 'none' },
  'keycap.edges': { label: 'Key edges', states: { down: 'key' }, image: 'none' },
  'keycap.face': { label: 'Key face', states: { down: 'key' }, image: 'region' },

  'button.key': {
    label: 'Button key',
    states: { lit: 'frame', armed: 'frame', holding: 'frame' },
    image: 'none',
  },
  'button.fill': { label: 'Button light', states: { on: 'self', flash: 'self' }, image: 'region' },
  'button.armed': { label: 'Armed wash', states: {}, image: 'region' },
  'button.hold': { label: 'Hold fill', states: {}, image: 'region' },
  'button.hint': { label: 'Armed hint', states: {}, image: 'none' },

  'switch.track': {
    label: 'Switch track',
    states: { on: 'frame', vertical: 'frame' },
    image: 'region',
  },
  'switch.legend': { label: 'ON / OFF legend', states: { on: 'frame' }, image: 'none' },
  'switch.tag': { label: 'Legend patch', states: { on: 'frame' }, image: 'none' },
  'switch.thumb': {
    label: 'Switch thumb',
    states: { on: 'frame', dragging: 'frame', vertical: 'frame' },
    image: 'region',
  },
  'switch.grip': { label: 'Thumb grip', states: { on: 'frame' }, image: 'glyph' },

  'slider.rail': { label: 'Fader rail', states: { vertical: 'frame' }, image: 'none' },
  'slider.ticks': { label: 'Fader scale', states: { vertical: 'frame' }, image: 'none' },
  'slider.track': {
    label: 'Fader track',
    states: { dragging: 'frame', vertical: 'frame' },
    image: 'region',
  },
  'slider.fill': {
    label: 'Fader fill',
    states: { dragging: 'frame', vertical: 'frame' },
    image: 'region',
  },
  'slider.cap': {
    label: 'Fader cap',
    states: { dragging: 'frame', vertical: 'frame' },
    image: 'region',
  },
  'slider.grip': {
    label: 'Cap grip',
    states: { dragging: 'frame', vertical: 'frame' },
    image: 'glyph',
  },

  'graph.plot': { label: 'Graph paper', states: { dragging: 'frame' }, image: 'region' },
  'graph.grid': { label: 'Graph grid', states: {}, image: 'region' },
  'graph.trail': { label: 'Trail', states: { fading: 'self' }, image: 'none' },
  'graph.dot': { label: 'Trail dot', states: {}, image: 'glyph' },
  'graph.cross': { label: 'Crosshair', states: { dragging: 'frame' }, image: 'line' },
  'graph.cursor': { label: 'Cursor', states: { dragging: 'frame' }, image: 'glyph' },
  'graph.lock': { label: 'Cursor brackets', states: { dragging: 'frame' }, image: 'glyph' },
  'graph.tick': { label: 'Axis labels', states: {}, image: 'none' },

  'pads.grid': { label: 'Pad grid', states: {}, image: 'none' },
  'pads.pad': { label: 'Pad', states: { on: 'self' }, image: 'none' },
  'pads.fill': { label: 'Pad light', states: { on: 'self', flash: 'self' }, image: 'region' },
  'pads.num': { label: 'Pad number', states: { on: 'self' }, image: 'none' },

  'list.options': { label: 'Option list', states: { horizontal: 'frame' }, image: 'none' },
  'list.option': {
    label: 'Option',
    states: { current: 'self', held: 'self', horizontal: 'frame' },
    image: 'region',
  },
  'list.fill': { label: 'Option light', states: { held: 'self', flash: 'self' }, image: 'region' },
  'list.mark': { label: 'Current mark', states: { current: 'self' }, image: 'none' },
  'list.text': { label: 'Option text', states: { current: 'self', held: 'self' }, image: 'none' },
} as const satisfies Record<string, Part>;

export type PartName = keyof typeof PARTS;

/**
 * Text and marks that read the same in every skin: where they are, their size and their
 * typography never change (skins/base.css, docs/SKINS.md). A skin colours them and may give
 * them a patch behind, never an image, a fade, or a different place.
 */
export const MARKER_PARTS: ReadonlySet<PartName> = new Set<PartName>([
  'frame.title',
  'frame.status',
  'button.hint',
  'switch.legend',
  'switch.tag',
  'slider.ticks',
  'graph.tick',
  'pads.num',
  'list.mark',
  'list.text',
]);

/**
 * What a skin may change besides paint: geometry, and the colour of the fader's scale (drawn
 * by skins/base.css, the same in every skin). Components and base.css read each with its
 * default as the fallback (`var(--slider-cap-len, 10px)`); nothing declares them but skins.
 */
export const TOKENS = {
  '--frame-inset-t': { label: 'Frame inside, top', default: '9px' },
  '--frame-inset-x': { label: 'Frame inside, sides', default: '7px' },
  '--frame-inset-b': { label: 'Frame inside, bottom', default: '7px' },
  '--switch-inset': { label: 'Switch thumb inset', default: '2px' },
  '--switch-thumb-len': {
    label: 'Switch thumb length',
    default: 'calc(50% - 2 * var(--switch-inset, 2px))',
  },
  '--slider-cap-len': { label: 'Fader cap thickness', default: '10px' },
  '--slider-track-w': { label: 'Fader track width', default: 'clamp(8px, 34%, 26px)' },
  '--slider-tick-c': { label: 'Fader scale colour', default: 'var(--fg-faint)' },
  '--graph-cursor': { label: 'Graph cursor size', default: '10px' },
  '--graph-dot': { label: 'Trail dot size', default: '4px' },
  '--graph-lock-inset': { label: 'Cursor brackets distance', default: '0px' },
  '--pads-gap': { label: 'Gap between pads', default: '4px' },
  '--list-gap': { label: 'Gap between options', default: '2px' },
  '--list-row-h': { label: 'Option height', default: 'var(--lh)' },
} as const;

export type Token = keyof typeof TOKENS;

/** `data-<state>` value for a boolean: present when true, absent when false. */
export const flag = (on: boolean | null | undefined): '' | undefined => (on ? '' : undefined);
