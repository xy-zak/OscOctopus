// Preset schema. The frontend owns this format; Rust stores it as opaque JSON (it only checks
// `id`, `name` and that `network` deserializes). Bump CURRENT_SCHEMA_VERSION and add a step to
// migrations.ts for every breaking change.
import { z } from 'zod';
import { SEQUENCER_LIMITS } from '../ipc/defaults';
import type { InputConfig, NetworkConfig, OutputConfig } from '../ipc/types';
import { PALETTE_SIZE } from '../theme/palettes';

export const CURRENT_SCHEMA_VERSION = 11;

/**
 * Every numeric range the schema enforces. The zod schemas below and the editor fields
 * (`NumberInput min/max`) both read these, so a limit is changed in exactly one place.
 */
export const LIMITS = {
  port: { min: 0, max: 65535 },
  multicastTtl: { min: 0, max: 255 },
  reconnectMs: { min: 100 },
  armTimeoutMs: { min: 300, max: 20000 },
  holdMs: { min: 200, max: 5000 },
  /** Rows and columns of a pads widget. */
  padsSide: { min: 1, max: 8 },
  listOptions: { min: 1, max: 64 },
  /** Columns and rows of a desk's grid. */
  gridSide: { min: 1, max: 48 },
  gridGap: { min: 0, max: 48 },
  /** Custom palettes (GLOBAL SETTINGS › LOOK) and the length of their names. */
  customPalettes: { min: 0, max: 32 },
  paletteName: { min: 1, max: 12 },
  /** A sequencer's steps, the wait after each (ms) and its passes; Rust enforces them too. */
  seqSteps: { min: 1, max: SEQUENCER_LIMITS.maxSteps },
  seqDelayMs: { min: 0, max: SEQUENCER_LIMITS.maxDelayMs },
  seqCount: { min: 1, max: SEQUENCER_LIMITS.maxCount },
  /** A text widget's source, and the most of a received text it shows. */
  textChars: { min: 0, max: 2000 },
  /** Decimal places a text widget shows numbers with. */
  textDecimals: { min: 0, max: 6 },
  /** Rows a log widget keeps. */
  logRows: { min: 1, max: 200 },
} as const;

/**
 * Editor-only ranges: sensible bounds for typing a value, deliberately not enforced on saved
 * presets (tightening the schema would reject presets that are valid today).
 */
export const EDITOR_LIMITS = {
  /** A port others must know (an output's target, an input's listen port): 0 would mean "any". */
  knownPort: { min: 1, max: LIMITS.port.max },
  reconnectMs: { ...LIMITS.reconnectMs, max: 600_000 },
  maxRateHz: { min: 0, max: 1000 },
} as const;

type Range = { readonly min: number; readonly max?: number };
const inRange = (n: z.ZodNumber, r: Range) =>
  r.max === undefined ? n.min(r.min) : n.min(r.min).max(r.max);

/** Names that would collide with object internals when used as keys (ids arrive from peers). */
const RESERVED_IDS = new Set(['__proto__', 'constructor', 'prototype']);

export const IdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, 'ids use 1-64 of A-Z a-z 0-9 - _')
  .refine((id) => !RESERVED_IDS.has(id), 'this id is reserved');

// ---- Network (mirrors the Rust types; `satisfies` keeps them in lock-step) -----------------

const Transport = z.enum(['udp', 'tcp']);
const TcpFraming = z.enum(['slip', 'lengthPrefix']);
const Port = inRange(z.number().int(), LIMITS.port);

export const OutputConfigSchema = z.object({
  id: IdSchema,
  name: z.string(),
  enabled: z.boolean(),
  transport: Transport,
  host: z.string(),
  port: Port,
  mode: z.enum(['unicast', 'broadcast', 'multicast']),
  bindAddress: z.string(),
  localPort: Port,
  multicastTtl: inRange(z.number().int(), LIMITS.multicastTtl),
  multicastLoop: z.boolean(),
  framing: TcpFraming,
  reconnectMs: inRange(z.number().int(), LIMITS.reconnectMs),
}) satisfies z.ZodType<OutputConfig>;

export const InputConfigSchema = z.object({
  id: IdSchema,
  name: z.string(),
  enabled: z.boolean(),
  transport: Transport,
  bindAddress: z.string(),
  port: Port,
  multicastGroup: z.string().nullable(),
  framing: TcpFraming,
}) satisfies z.ZodType<InputConfig>;

export const NetworkConfigSchema = z.object({
  outputs: z.array(OutputConfigSchema),
  inputs: z.array(InputConfigSchema),
}) satisfies z.ZodType<NetworkConfig>;

// ---- Messages -------------------------------------------------------------------------------

/**
 * How (a channel of) the widget's value becomes OSC argument(s):
 * - f i d h: numbers · TF: true/false · s: string
 * - auto: inferred from the value (number → f, string → s, boolean → T/F, list → array)
 * - []: an OSC array of the list's items · ...: the list's items as separate arguments
 * - m: an OSC MIDI message built from a note event (note on/off, velocity, channel). No
 *   built-in widget produces note events yet; this is here for future ones (a keyboard).
 */
export const ValueArgType = z.enum(['f', 'i', 'd', 'h', 'TF', 's', 'auto', '[]', '...', 'm']);
export type ValueArgType = z.infer<typeof ValueArgType>;

export const ConstArgType = z.enum(['f', 'i', 'd', 'h', 's', 'T', 'F', 'N', 'I']);
export type ConstArgType = z.infer<typeof ConstArgType>;

/**
 * Which part of a widget's value an argument carries: a named channel of a record value
 * (graph: x y · pads: number row col on · list: index label value), or an index into a list value. Single-value widgets ignore it.
 */
export const Channel = z.string().max(32);
export type Channel = z.infer<typeof Channel>;

/** A fixed argument, stored as a string so the editor can hold any value (converted at send time). */
export const ConstArgSchema = z.object({
  kind: z.literal('const'),
  type: ConstArgType,
  value: z.string(),
});
export type ConstArg = z.infer<typeof ConstArgSchema>;

export const ArgTemplateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('value'), type: ValueArgType, channel: Channel.optional() }),
  ConstArgSchema,
]);
export type ArgTemplate = z.infer<typeof ArgTemplateSchema>;

/**
 * One OSC message of a widget. It can go both ways: `send` sends it to `outputIds` whenever
 * the widget changes; `receive` listens for it on `sourceIds` (inputs of the desk, or outputs,
 * meaning replies arriving on that output's socket) and sets the widget from it. `forward`
 * re-sends the widget's messages after received input changed it (a bridge); off by default.
 */
export const BindingSchema = z.object({
  id: IdSchema,
  send: z.boolean(),
  outputIds: z.array(IdSchema),
  receive: z.boolean(),
  sourceIds: z.array(IdSchema),
  forward: z.boolean(),
  address: z.string(),
  args: z.array(ArgTemplateSchema),
});
export type Binding = z.infer<typeof BindingSchema>;

// ---- Widgets --------------------------------------------------------------------------------

export const ColorIndex = z
  .number()
  .int()
  .min(0)
  .max(PALETTE_SIZE - 1);

/** What a widget shows in its frame's border: its title (label) and its value readout. */
export const WidgetShowSchema = z.object({ title: z.boolean(), value: z.boolean() });
export type WidgetShow = z.infer<typeof WidgetShowSchema>;

const WidgetBase = z.object({
  id: IdSchema,
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
  label: z.string(),
  /** Index into its desk's palette (0–9); null (AUTO) uses the desk's colour. */
  color: ColorIndex.nullable(),
  show: WidgetShowSchema,
  bindings: z.array(BindingSchema),
});

export const ButtonPropsSchema = z.object({
  /** momentary: on value while held, off value on release · trigger: on value on press only. */
  mode: z.enum(['momentary', 'trigger']),
  onValue: z.number(),
  offValue: z.number(),
  /**
   * Arm-then-fire safety. none: fires on press · double: first press arms (for
   * armTimeoutMs), a second press fires · hold: fires only after holding for holdMs.
   */
  arm: z.enum(['none', 'double', 'hold']),
  armTimeoutMs: inRange(z.number().int(), LIMITS.armTimeoutMs),
  holdMs: inRange(z.number().int(), LIMITS.holdMs),
});
export type ButtonProps = z.infer<typeof ButtonPropsSchema>;

export const SliderPropsSchema = z.object({
  orientation: z.enum(['vertical', 'horizontal']),
  min: z.number(),
  max: z.number(),
  /** 0 = continuous. */
  step: z.number().min(0),
  curve: z.enum(['linear', 'exp', 'log']),
  /** absolute: jump to the touch point · relative: drag from the current value. */
  touch: z.enum(['absolute', 'relative']),
  defaultValue: z.number(),
  /** Messages per second while dragging; 0 = every pointer event. The final value always sends. */
  maxRateHz: z.number().min(0),
});
export type SliderProps = z.infer<typeof SliderPropsSchema>;

export const SwitchPropsSchema = z.object({
  onValue: z.number(),
  offValue: z.number(),
});
export type SwitchProps = z.infer<typeof SwitchPropsSchema>;

/** One axis of the graph: its own range, step and curve, like a fader. */
export const AxisSchema = z.object({
  label: z.string(),
  min: z.number(),
  max: z.number(),
  step: z.number().min(0),
  curve: z.enum(['linear', 'exp', 'log']),
  defaultValue: z.number(),
});
export type Axis = z.infer<typeof AxisSchema>;

export const GraphPropsSchema = z.object({
  x: AxisSchema,
  y: AxisSchema,
  touch: z.enum(['absolute', 'relative']),
  /** Show a fading trail of recent points. */
  trail: z.boolean(),
  maxRateHz: z.number().min(0),
});
export type GraphProps = z.infer<typeof GraphPropsSchema>;

/**
 * A grid of numbered pads, 1…rows×cols in reading order (top-left = 1). Every hit sends
 * {number, row, col, on}; row and col count from 1 at the top-left.
 */
export const PadsPropsSchema = z.object({
  rows: inRange(z.number().int(), LIMITS.padsSide),
  cols: inRange(z.number().int(), LIMITS.padsSide),
  /** momentary: on while held · toggle: flips per hit · trigger: on only. */
  mode: z.enum(['momentary', 'toggle', 'trigger']),
});
export type PadsProps = z.infer<typeof PadsPropsSchema>;

export const ListOptionSchema = z.object({ label: z.string(), value: z.string() });
export type ListOption = z.infer<typeof ListOptionSchema>;

/** Pick one of N options. Sends {index, label, value}. */
export const ListPropsSchema = z.object({
  options: z.array(ListOptionSchema).min(LIMITS.listOptions.min).max(LIMITS.listOptions.max),
  defaultIndex: z.number().int().min(0),
  layout: z.enum(['auto', 'vertical', 'horizontal']),
});
export type ListProps = z.infer<typeof ListPropsSchema>;

/** One message of a sequence, and how long to wait after it before the next. */
export const SeqStepSchema = z.object({
  id: IdSchema,
  address: z.string(),
  args: z.array(ConstArgSchema),
  delayMs: inRange(z.number().int(), LIMITS.seqDelayMs),
});
export type SeqStep = z.infer<typeof SeqStepSchema>;

/**
 * Messages played in a loop by the Rust core (src-tauri/src/sequencer.rs), each followed by
 * its wait. Every step goes to `outputIds`; `repeat` plays it forever or `count` passes.
 */
export const SequencerPropsSchema = z.object({
  outputIds: z.array(IdSchema),
  steps: z.array(SeqStepSchema).min(LIMITS.seqSteps.min).max(LIMITS.seqSteps.max),
  repeat: z.enum(['forever', 'count']),
  count: inRange(z.number().int(), LIMITS.seqCount),
});
export type SequencerProps = z.infer<typeof SequencerPropsSchema>;

/**
 * A block of text in a small markup (widgets/text/markup.ts). Its `{value}` placeholders show
 * nothing in `text` mode, the value its messages receive in `osc` mode, and the live value of
 * `target` (a widget on the same desk) in `monitor` mode.
 */
export const TextPropsSchema = z.object({
  mode: z.enum(['text', 'osc', 'monitor']),
  source: z.string().max(LIMITS.textChars.max),
  /**
   * The largest the text is drawn (fit: as large as the box allows). It shrinks to fit the
   * box, and is cut with an ellipsis when even the smallest size doesn't (widgets/text/fit.ts).
   * The one exception to the app's one text size (docs/ARCHITECTURE.md › Visual system).
   */
  size: z.enum(['fit', 's', 'm', 'l', 'xl']),
  align: z.enum(['left', 'center', 'right']),
  valign: z.enum(['top', 'middle', 'bottom']),
  target: IdSchema.nullable(),
  /** Decimal places for numbers that aren't whole. */
  decimals: inRange(z.number().int(), LIMITS.textDecimals),
});
export type TextProps = z.infer<typeof TextPropsSchema>;

/** What a log widget can show about each message, in column order. */
export const LOG_COLUMNS = [
  'time',
  'dir',
  'widget',
  'address',
  'value',
  'endpoint',
  'ip',
  'result',
  'size',
] as const;
export type LogColumn = (typeof LOG_COLUMNS)[number];

/** Messages widgets sent and received, newest first: this device's own traffic, never synced. */
export const LogPropsSchema = z.object({
  /** desk: every widget of its desk · chosen: the widgets in `sources`. */
  follow: z.enum(['desk', 'chosen']),
  sources: z.array(IdSchema),
  rows: inRange(z.number().int(), LIMITS.logRows),
  columns: z.array(z.enum(LOG_COLUMNS)),
});
export type LogProps = z.infer<typeof LogPropsSchema>;

export const ButtonWidgetSchema = WidgetBase.extend({
  type: z.literal('button'),
  props: ButtonPropsSchema,
});
export const SliderWidgetSchema = WidgetBase.extend({
  type: z.literal('slider'),
  props: SliderPropsSchema,
});
export const SwitchWidgetSchema = WidgetBase.extend({
  type: z.literal('switch'),
  props: SwitchPropsSchema,
});
export const GraphWidgetSchema = WidgetBase.extend({
  type: z.literal('graph'),
  props: GraphPropsSchema,
});
export const PadsWidgetSchema = WidgetBase.extend({
  type: z.literal('pads'),
  props: PadsPropsSchema,
});
export const ListWidgetSchema = WidgetBase.extend({
  type: z.literal('list'),
  props: ListPropsSchema,
});
export const SequencerWidgetSchema = WidgetBase.extend({
  type: z.literal('sequencer'),
  props: SequencerPropsSchema,
});
export const TextWidgetSchema = WidgetBase.extend({
  type: z.literal('text'),
  props: TextPropsSchema,
});
export const LogWidgetSchema = WidgetBase.extend({
  type: z.literal('log'),
  props: LogPropsSchema,
});
export const WidgetSchema = z.discriminatedUnion('type', [
  ButtonWidgetSchema,
  SwitchWidgetSchema,
  SliderWidgetSchema,
  GraphWidgetSchema,
  PadsWidgetSchema,
  ListWidgetSchema,
  SequencerWidgetSchema,
  TextWidgetSchema,
  LogWidgetSchema,
]);

export type ButtonWidget = z.infer<typeof ButtonWidgetSchema>;
export type SwitchWidget = z.infer<typeof SwitchWidgetSchema>;
export type SliderWidget = z.infer<typeof SliderWidgetSchema>;
export type GraphWidget = z.infer<typeof GraphWidgetSchema>;
export type PadsWidget = z.infer<typeof PadsWidgetSchema>;
export type ListWidget = z.infer<typeof ListWidgetSchema>;
export type SequencerWidget = z.infer<typeof SequencerWidgetSchema>;
export type TextWidget = z.infer<typeof TextWidgetSchema>;
export type LogWidget = z.infer<typeof LogWidgetSchema>;
export type Widget = z.infer<typeof WidgetSchema>;
export type WidgetType = Widget['type'];

// ---- Preset ---------------------------------------------------------------------------------

export const GridSchema = z.object({
  cols: inRange(z.number().int(), LIMITS.gridSide),
  rows: inRange(z.number().int(), LIMITS.gridSide),
  /** Gap between cells in CSS px. */
  gap: inRange(z.number(), LIMITS.gridGap),
});
export type Grid = z.infer<typeof GridSchema>;

export const HexColor = z.string().regex(/^#[0-9a-f]{6}$/);

/** Id of a custom palette, e.g. `custom-k3x9q0a1b2` (never a built-in palette's id). */
export const CustomPaletteId = z.string().regex(/^custom-[a-z0-9]{1,32}$/);

/**
 * A palette made in LOOK from one source colour (see theme/generate.ts): nine colours and the
 * accent, last, like every palette. `colors` is the truth; `source` and `overridden` are kept so
 * editing it later regenerates only the colours that weren't picked by hand.
 */
export const CustomPaletteSchema = z.object({
  id: CustomPaletteId,
  name: z.string().trim().min(LIMITS.paletteName.min).max(LIMITS.paletteName.max),
  source: HexColor,
  colors: z.array(HexColor).length(PALETTE_SIZE),
  overridden: z.array(z.boolean()).length(PALETTE_SIZE),
});
export type CustomPalette = z.infer<typeof CustomPaletteSchema>;

/**
 * The device's colours beyond the look (theme/look.ts, which picks the palette): dark or light,
 * and the custom palettes. A global setting since v4, no longer part of a preset. Saved themes
 * from before looks also name a palette; `look` is made from it once. Older ones also chose an
 * accent, which is now each palette's own.
 */
export const ThemeSchema = z.object({
  /** Background: dark (default) or light. Older saved themes without it are dark. */
  mode: z.enum(['dark', 'light']).default('dark'),
  /** The palettes made on this device. Older saved themes have none. */
  custom: z.array(CustomPaletteSchema).max(LIMITS.customPalettes.max).default([]),
});
export type Theme = z.infer<typeof ThemeSchema>;

export const PresetSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  id: IdSchema,
  name: z.string().min(1),
  /** The desk's identity colour (an index into its palette): its tab and frame, so you always
   *  know which desk you are in. */
  color: ColorIndex,
  createdAt: z.string(),
  updatedAt: z.string(),
  grid: GridSchema,
  network: NetworkConfigSchema,
  widgets: z.array(WidgetSchema),
});
export type Preset = z.infer<typeof PresetSchema>;
