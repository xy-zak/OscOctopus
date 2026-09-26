// Preset schema. The frontend owns this format; Rust stores it as opaque JSON (it only checks
// `id`, `name` and that `network` deserializes). Bump CURRENT_SCHEMA_VERSION and add a step to
// migrations.ts for every breaking change.
import { z } from 'zod';
import type { InputConfig, NetworkConfig, OutputConfig } from '../ipc/types';
import { PALETTE_IDS, PALETTE_SIZE } from '../theme/palettes';

export const CURRENT_SCHEMA_VERSION = 7;

export const IdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, 'ids use 1-64 of A-Z a-z 0-9 - _');

// ---- Network (mirrors the Rust types; `satisfies` keeps them in lock-step) -----------------

const Transport = z.enum(['udp', 'tcp']);
const TcpFraming = z.enum(['slip', 'lengthPrefix']);
const Port = z.number().int().min(0).max(65535);

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
  multicastTtl: z.number().int().min(0).max(255),
  multicastLoop: z.boolean(),
  framing: TcpFraming,
  reconnectMs: z.number().int().min(100),
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
 * (graph: x y · knob: value delta · pads: number row col on · list: index label value), or an index into a list value. Single-value widgets ignore it.
 */
export const Channel = z.string().max(32);
export type Channel = z.infer<typeof Channel>;

export const ArgTemplateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('value'), type: ValueArgType, channel: Channel.optional() }),
  // Stored as a string so the editor can hold any value; converted at send time.
  z.object({ kind: z.literal('const'), type: ConstArgType, value: z.string() }),
]);
export type ArgTemplate = z.infer<typeof ArgTemplateSchema>;

export const BindingSchema = z.object({
  id: IdSchema,
  enabled: z.boolean(),
  outputIds: z.array(IdSchema),
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

const WidgetBase = z.object({
  id: IdSchema,
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
  label: z.string(),
  /** Index into the global palette (0–9); null uses the accent. */
  color: ColorIndex.nullable(),
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
  armTimeoutMs: z.number().int().min(300).max(20000),
  holdMs: z.number().int().min(200).max(5000),
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

/** Rotary control. bounded: a pot with a range, like a fader · endless: an encoder. */
export const KnobPropsSchema = z.object({
  mode: z.enum(['bounded', 'endless']),
  min: z.number(),
  max: z.number(),
  step: z.number().min(0),
  curve: z.enum(['linear', 'exp', 'log']),
  defaultValue: z.number(),
  /** Endless: size of one detent's delta (sent as channel `delta`). */
  deltaStep: z.number().positive(),
  /** Endless: drag distance in px per detent. */
  detentPx: z.number().min(2).max(200),
  maxRateHz: z.number().min(0),
});
export type KnobProps = z.infer<typeof KnobPropsSchema>;

/**
 * A grid of numbered pads, 1…rows×cols in reading order (top-left = 1). Every hit sends
 * {number, row, col, on}; row and col count from 1 at the top-left.
 */
export const PadsPropsSchema = z.object({
  rows: z.number().int().min(1).max(8),
  cols: z.number().int().min(1).max(8),
  /** momentary: on while held · toggle: flips per hit · trigger: on only. */
  mode: z.enum(['momentary', 'toggle', 'trigger']),
});
export type PadsProps = z.infer<typeof PadsPropsSchema>;

export const ListOptionSchema = z.object({ label: z.string(), value: z.string() });
export type ListOption = z.infer<typeof ListOptionSchema>;

/** Pick one of N options. Sends {index, label, value}. */
export const ListPropsSchema = z.object({
  options: z.array(ListOptionSchema).min(1).max(64),
  defaultIndex: z.number().int().min(0),
  layout: z.enum(['auto', 'vertical', 'horizontal']),
});
export type ListProps = z.infer<typeof ListPropsSchema>;

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
export const KnobWidgetSchema = WidgetBase.extend({
  type: z.literal('knob'),
  props: KnobPropsSchema,
});
export const PadsWidgetSchema = WidgetBase.extend({
  type: z.literal('pads'),
  props: PadsPropsSchema,
});
export const ListWidgetSchema = WidgetBase.extend({
  type: z.literal('list'),
  props: ListPropsSchema,
});
export const WidgetSchema = z.discriminatedUnion('type', [
  ButtonWidgetSchema,
  SwitchWidgetSchema,
  SliderWidgetSchema,
  KnobWidgetSchema,
  GraphWidgetSchema,
  PadsWidgetSchema,
  ListWidgetSchema,
]);

export type ButtonWidget = z.infer<typeof ButtonWidgetSchema>;
export type SwitchWidget = z.infer<typeof SwitchWidgetSchema>;
export type SliderWidget = z.infer<typeof SliderWidgetSchema>;
export type KnobWidget = z.infer<typeof KnobWidgetSchema>;
export type GraphWidget = z.infer<typeof GraphWidgetSchema>;
export type PadsWidget = z.infer<typeof PadsWidgetSchema>;
export type ListWidget = z.infer<typeof ListWidgetSchema>;
export type Widget = z.infer<typeof WidgetSchema>;
export type WidgetType = Widget['type'];

// ---- Preset ---------------------------------------------------------------------------------

export const GridSchema = z.object({
  cols: z.number().int().min(1).max(48),
  rows: z.number().int().min(1).max(48),
  /** Gap between cells in CSS px. */
  gap: z.number().min(0).max(48),
});
export type Grid = z.infer<typeof GridSchema>;

/** The app-wide look (a global setting since v4, no longer part of a preset). */
export const ThemeSchema = z.object({
  palette: z.enum(PALETTE_IDS),
  /** Palette index used for the UI accent and for widgets without their own colour. */
  accent: ColorIndex,
  /** Background: dark (default) or light. Older saved themes without it are dark. */
  mode: z.enum(['dark', 'light']).default('dark'),
});
export type Theme = z.infer<typeof ThemeSchema>;

export const PresetSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  id: IdSchema,
  name: z.string().min(1),
  /** The desk's identity colour (palette index): its tab and frame, so you always know
   *  which desk you are in. */
  color: ColorIndex,
  createdAt: z.string(),
  updatedAt: z.string(),
  grid: GridSchema,
  network: NetworkConfigSchema,
  widgets: z.array(WidgetSchema),
});
export type Preset = z.infer<typeof PresetSchema>;
