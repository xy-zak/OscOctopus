import { nearestIndex, PALETTE_SIZE } from '../theme/palettes';
import { CURRENT_SCHEMA_VERSION, PresetSchema, type Preset } from './preset';

type Raw = Record<string, unknown>;

/**
 * Upgrade steps keyed by the version they upgrade *from*. Each step receives the raw JSON of
 * version N and returns version N+1. Example for a future v2:
 *
 *   1: (p) => ({ ...p, schemaVersion: 2, theme: { ...(p.theme as Raw), font: 'system' } }),
 */
const steps: Record<number, (preset: Raw) => Raw> = {
  // v2: "toggle" stopped being a button mode and became its own Switch widget.
  1: (p) => ({
    ...p,
    schemaVersion: 2,
    widgets: ((p.widgets as Raw[] | undefined) ?? []).map((w) => {
      const props = w.props as Raw | undefined;
      if (w.type !== 'button' || props?.mode !== 'toggle') return w;
      return { ...w, type: 'switch', props: { onValue: props.onValue, offValue: props.offValue } };
    }),
  }),
  // v3: free CSS colours became palette indices; the theme became { palette, accent }.
  // Old colours map to the nearest RAINBOW colour so desks keep roughly their look.
  2: (p) => {
    const theme = (p.theme as Raw | undefined) ?? {};
    const toIndex = (c: unknown) => (typeof c === 'string' ? nearestIndex(c, 'rainbow') : null);
    return {
      ...p,
      schemaVersion: 3,
      theme: { palette: 'rainbow', accent: toIndex(theme.accent) ?? 5 },
      widgets: ((p.widgets as Raw[] | undefined) ?? []).map((w) => ({
        ...w,
        color: toIndex(w.color),
      })),
    };
  },
  // v4: the palette became a global setting shared by all desks, so presets no longer carry a
  // theme. (The workspace seeds the global palette from the first desk's old theme.)
  3: (p) => {
    const rest = { ...p };
    delete rest.theme;
    return { ...rest, schemaVersion: 4 };
  },
  // v5: every desk has an identity colour (its tab + frame). Derived from the id so a desk
  // keeps the same colour across devices.
  4: (p) => ({ ...p, schemaVersion: 5, color: colorFromId(String(p.id ?? '')) }),
  // v6: buttons can be arm-then-fire (off by default); new widget types knob/pads/list, and
  // message values can be strings, lists and note events.
  5: (p) => ({
    ...p,
    schemaVersion: 6,
    widgets: ((p.widgets as Raw[] | undefined) ?? []).map((w) =>
      w.type === 'button'
        ? { ...w, props: { arm: 'none', armTimeoutMs: 3000, holdMs: 800, ...(w.props as Raw) } }
        : w,
    ),
  }),
  // v7: pads are a plain numbered grid ({number, row, col, on}), no notes or velocity.
  // Bindings that used the old note-event channels are pointed at the nearest new one.
  6: (p) => ({
    ...p,
    schemaVersion: 7,
    widgets: ((p.widgets as Raw[] | undefined) ?? []).map((w) =>
      w.type === 'pads' ? padsToNumbers(w) : w,
    ),
  }),
  // v8: messages can also be received (OSC input drives widgets). `enabled` became `send`;
  // nothing receives or forwards until the user turns it on.
  7: (p) => ({
    ...p,
    schemaVersion: 8,
    widgets: ((p.widgets as Raw[] | undefined) ?? []).map((w) => ({
      ...w,
      bindings: ((w.bindings as Raw[] | undefined) ?? []).map(({ enabled, ...b }) => ({
        ...b,
        send: enabled !== false,
        receive: false,
        sourceIds: [],
        forward: false,
      })),
    })),
  }),
  // v9: the knob widget is gone. Each knob becomes a fader in the same place, with the same
  // range, curve, rate and messages, so nothing it sent or received is lost.
  8: (p) => ({
    ...p,
    schemaVersion: 9,
    widgets: ((p.widgets as Raw[] | undefined) ?? []).map((w) =>
      w.type === 'knob' ? knobToFader(w) : w,
    ),
  }),
};

const OLD_PAD_CHANNELS: Record<string, string> = {
  index: 'number',
  note: 'number',
  velocity: 'on',
  channel: 'number',
};

function padsToNumbers(w: Raw): Raw {
  const { rows, cols, mode } = (w.props ?? {}) as Raw;
  const bindings = ((w.bindings as Raw[] | undefined) ?? []).map((b) => ({
    ...b,
    address: String(b.address ?? '').replace(
      /\{(index|note|velocity|channel)\}/g,
      (_, ch: string) => `{${OLD_PAD_CHANNELS[ch]}}`,
    ),
    args: ((b.args as Raw[] | undefined) ?? []).map((a) => {
      if (a.kind !== 'value') return a;
      if (a.type === 'm') return { kind: 'value', type: 'i', channel: 'number' };
      const ch = typeof a.channel === 'string' ? OLD_PAD_CHANNELS[a.channel] : undefined;
      return ch ? { ...a, channel: ch } : a;
    }),
  }));
  return { ...w, props: { rows, cols, mode }, bindings };
}

/**
 * A knob as a fader. A fader has one value, so an endless knob's `value` and `delta` channels
 * (in arguments and `{placeholders}`) both become that value: without this, a received
 * `delta` would set nothing.
 */
function knobToFader(w: Raw): Raw {
  const { min, max, step, curve, defaultValue, maxRateHz } = (w.props ?? {}) as Raw;
  const bindings = ((w.bindings as Raw[] | undefined) ?? []).map((b) => ({
    ...b,
    address: String(b.address ?? '').replace(/\{delta\}/g, '{value}'),
    args: ((b.args as Raw[] | undefined) ?? []).map((a) => {
      if (a.kind !== 'value') return a;
      const rest = { ...a };
      delete rest.channel;
      return rest;
    }),
  }));
  return {
    ...w,
    type: 'slider',
    props: {
      orientation: Number(w.h) >= Number(w.w) ? 'vertical' : 'horizontal',
      min,
      max,
      step,
      curve,
      touch: 'relative',
      defaultValue,
      maxRateHz,
    },
    bindings,
  };
}

export class PresetError extends Error {}

/** Stable palette index for an id (FNV-1a hash). */
export function colorFromId(id: string): number {
  let h = 0x811c9dc5;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
  return (h >>> 0) % PALETTE_SIZE;
}

/** Migrates any known older version to the current schema and validates it. */
export function migratePreset(input: unknown): Preset {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new PresetError('preset is not a JSON object');
  }
  let preset = input as Raw;
  const declared = preset.schemaVersion;
  if (typeof declared !== 'number' || !Number.isInteger(declared)) {
    throw new PresetError('preset has no numeric schemaVersion');
  }
  let version = declared;
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new PresetError(
      `preset uses schema v${version}, but this app only understands up to v${CURRENT_SCHEMA_VERSION}; update the app`,
    );
  }
  while (version < CURRENT_SCHEMA_VERSION) {
    const step = steps[version];
    if (!step) throw new PresetError(`no migration from schema v${version}`);
    preset = step(preset);
    version = preset.schemaVersion as number;
  }
  const result = PresetSchema.safeParse(preset);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new PresetError(`preset is invalid: ${issues}`);
  }
  return result.data;
}
