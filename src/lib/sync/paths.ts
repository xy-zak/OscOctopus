// A shared desk as a flat record of fields that change independently. Two people editing
// different fields of the same widget both keep their change; editing the same field, the
// later change wins (deskdoc.ts). The keys:
//
//   name · color · grid                            the desk
//   w/<id>                {type}                   a widget exists (its stamp orders widgets)
//   w/<id>/rect           {x,y,w,h}                moved or resized together, never half
//   w/<id>/label · w/<id>/color · w/<id>/bindings  (all bindings are one unit)
//   w/<id>/props/<key>                             each prop on its own
//   o/<id> · i/<id>       {}                       an output / input exists
//   o/<id>/cfg · i/<id>/cfg                        its settings, minus the machine's own
//
// Not synced (each device keeps its own): the addresses an endpoint binds to on this machine
// (output bindAddress and localPort, input bindAddress), and the preset's timestamps.
import { z } from 'zod';
import {
  BindingSchema,
  ColorIndex,
  GridSchema,
  InputConfigSchema,
  OutputConfigSchema,
  WidgetSchema,
  type Preset,
  type Widget,
  type WidgetType,
} from '../model/preset';
import type { InputConfig, OutputConfig } from '../ipc/types';
import { compareStamps } from './hlc';
import type { Stamp } from './protocol';

/** Output / input settings that belong to one machine. */
const OUTPUT_LOCAL = { bindAddress: '0.0.0.0', localPort: 0 } as const;
const INPUT_LOCAL = { bindAddress: '0.0.0.0' } as const;

const SharedOutputSchema = OutputConfigSchema.omit({
  id: true,
  bindAddress: true,
  localPort: true,
});
const SharedInputSchema = InputConfigSchema.omit({ id: true, bindAddress: true });
const RectSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
});
const WIDGET_TYPES = WidgetSchema.options.map((o) => o.shape.type.value) as [
  WidgetType,
  ...WidgetType[],
];
const CreateWidgetSchema = z.object({ type: z.enum(WIDGET_TYPES) });
const CreateEndpointSchema = z.object({}).strict();

export type Flat = Map<string, unknown>;

/** A deep copy that also works on Svelte state proxies (which structuredClone refuses). */
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export type ParsedKey =
  | { group: 'desk'; field: 'name' | 'color' | 'grid' }
  | { group: 'widget'; id: string; part: 'create' | 'rect' | 'label' | 'color' | 'bindings' }
  | { group: 'widget'; id: string; part: 'prop'; prop: string }
  | { group: 'output' | 'input'; id: string; part: 'create' | 'cfg' };

const ID = '[A-Za-z0-9_-]{1,64}';
const WIDGET_KEY = new RegExp(
  `^w/(${ID})(?:/(rect|label|color|bindings)|/props/([A-Za-z0-9_]{1,64}))?$`,
);
const ENDPOINT_KEY = new RegExp(`^([oi])/(${ID})(/cfg)?$`);

export function parseKey(key: string): ParsedKey | null {
  if (key === 'name' || key === 'color' || key === 'grid') return { group: 'desk', field: key };
  const w = WIDGET_KEY.exec(key);
  if (w) {
    const id = w[1]!;
    if (w[3]) return { group: 'widget', id, part: 'prop', prop: w[3] };
    const part = (w[2] ?? 'create') as 'create' | 'rect' | 'label' | 'color' | 'bindings';
    return { group: 'widget', id, part };
  }
  const e = ENDPOINT_KEY.exec(key);
  if (e)
    return { group: e[1] === 'o' ? 'output' : 'input', id: e[2]!, part: e[3] ? 'cfg' : 'create' };
  return null;
}

/** The creation key a key belongs to (a widget's or endpoint's), or null for desk fields. */
export function ownerKey(key: string): string | null {
  const p = parseKey(key);
  if (!p || p.group === 'desk') return null;
  return `${p.group === 'widget' ? 'w' : p.group === 'output' ? 'o' : 'i'}/${p.id}`;
}

const PROP_SCHEMAS = new Map(
  WidgetSchema.options.map((o) => [
    o.shape.type.value,
    o.shape.props.shape as Record<string, z.ZodType>,
  ]),
);

/**
 * Whether `value` may be stored under `key`. `typeOf` gives a widget's type when known, so
 * props are checked against it; otherwise they are checked when the widget is built.
 */
export function validEntry(
  key: string,
  value: unknown,
  typeOf: (id: string) => WidgetType | undefined,
): boolean {
  const p = parseKey(key);
  if (!p) return false;
  const ok = (schema: z.ZodType) => schema.safeParse(value).success;
  switch (p.group) {
    case 'desk':
      return p.field === 'name'
        ? ok(z.string().min(1).max(200))
        : p.field === 'color'
          ? ok(ColorIndex)
          : ok(GridSchema);
    case 'widget':
      switch (p.part) {
        case 'create':
          return ok(CreateWidgetSchema);
        case 'rect':
          return ok(RectSchema);
        case 'label':
          return ok(z.string().max(500));
        case 'color':
          return ok(ColorIndex.nullable());
        case 'bindings':
          return ok(z.array(BindingSchema).max(64));
        case 'prop': {
          const type = typeOf(p.id);
          if (!type) return true;
          const schema = PROP_SCHEMAS.get(type)?.[p.prop];
          return schema ? ok(schema) : false;
        }
      }
      return false;
    case 'output':
      return ok(p.part === 'create' ? CreateEndpointSchema : SharedOutputSchema);
    case 'input':
      return ok(p.part === 'create' ? CreateEndpointSchema : SharedInputSchema);
  }
}

function withoutKeys<T extends object>(obj: T, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));
}

/** A desk as record fields (plain values; nothing shared with the desk by reference). */
export function flatten(desk: Preset): Flat {
  const out: Flat = new Map();
  out.set('name', desk.name);
  out.set('color', desk.color);
  out.set('grid', { ...desk.grid });
  for (const w of desk.widgets) {
    out.set(`w/${w.id}`, { type: w.type });
    out.set(`w/${w.id}/rect`, { x: w.x, y: w.y, w: w.w, h: w.h });
    out.set(`w/${w.id}/label`, w.label);
    out.set(`w/${w.id}/color`, w.color);
    out.set(`w/${w.id}/bindings`, clone(w.bindings));
    for (const [k, v] of Object.entries(w.props)) out.set(`w/${w.id}/props/${k}`, clone(v));
  }
  for (const o of desk.network.outputs) {
    out.set(`o/${o.id}`, {});
    out.set(`o/${o.id}/cfg`, clone(withoutKeys(o, ['id', ...Object.keys(OUTPUT_LOCAL)])));
  }
  for (const i of desk.network.inputs) {
    out.set(`i/${i.id}`, {});
    out.set(`i/${i.id}/cfg`, clone(withoutKeys(i, ['id', ...Object.keys(INPUT_LOCAL)])));
  }
  return out;
}

/** What a record holds for one key, as materialize reads it. */
export interface RecordView {
  /** The live value, or undefined if absent or deleted. */
  live(key: string): unknown;
  stamp(key: string): Stamp | undefined;
  keys(): Iterable<string>;
}

export interface Materialized {
  desk: Preset;
  /** Widgets and endpoints that could not be built (shown as a warning, never thrown). */
  invalid: { key: string; error: string }[];
}

/** Creation keys of one group that are alive, oldest first (ties by id). */
function alive(record: RecordView, prefix: 'w' | 'o' | 'i'): string[] {
  const ids: string[] = [];
  for (const key of record.keys()) {
    const p = parseKey(key);
    if (p && p.group !== 'desk' && p.part === 'create' && key.startsWith(`${prefix}/`)) {
      if (record.live(key) !== undefined) ids.push(p.id);
    }
  }
  const stampOf = (id: string) => record.stamp(`${prefix}/${id}`)!;
  return ids.sort((a, b) => compareStamps(stampOf(a), stampOf(b)) || (a < b ? -1 : 1));
}

/**
 * The desk a record describes. `local` supplies what the record doesn't hold: the preset's
 * identity and timestamps, and this machine's endpoint bind addresses.
 */
export function materialize(record: RecordView, local: Preset): Materialized {
  const invalid: Materialized['invalid'] = [];
  const pick = <T>(key: string, fallback: T): T => (record.live(key) as T | undefined) ?? fallback;

  const widgets: Widget[] = [];
  for (const id of alive(record, 'w')) {
    const create = record.live(`w/${id}`) as { type: WidgetType };
    const props: Record<string, unknown> = {};
    const prefix = `w/${id}/props/`;
    for (const key of record.keys()) {
      if (key.startsWith(prefix)) {
        const v = record.live(key);
        if (v !== undefined) props[key.slice(prefix.length)] = v;
      }
    }
    const rect = record.live(`w/${id}/rect`) as object | undefined;
    const candidate = {
      id,
      type: create.type,
      ...rect,
      label: record.live(`w/${id}/label`),
      color: record.live(`w/${id}/color`),
      bindings: record.live(`w/${id}/bindings`),
      props,
    };
    const parsed = WidgetSchema.safeParse(candidate);
    if (parsed.success) widgets.push(parsed.data);
    else invalid.push({ key: `w/${id}`, error: parsed.error.issues[0]?.message ?? 'invalid' });
  }

  const localOutputs = new Map(local.network.outputs.map((o) => [o.id, o]));
  const outputs: OutputConfig[] = [];
  for (const id of alive(record, 'o')) {
    const own = localOutputs.get(id);
    const candidate = {
      ...(record.live(`o/${id}/cfg`) as object | undefined),
      id,
      bindAddress: own?.bindAddress ?? OUTPUT_LOCAL.bindAddress,
      localPort: own?.localPort ?? OUTPUT_LOCAL.localPort,
    };
    const parsed = OutputConfigSchema.safeParse(candidate);
    if (parsed.success) outputs.push(parsed.data);
    else invalid.push({ key: `o/${id}`, error: parsed.error.issues[0]?.message ?? 'invalid' });
  }

  const localInputs = new Map(local.network.inputs.map((i) => [i.id, i]));
  const inputs: InputConfig[] = [];
  for (const id of alive(record, 'i')) {
    const own = localInputs.get(id);
    const candidate = {
      ...(record.live(`i/${id}/cfg`) as object | undefined),
      id,
      bindAddress: own?.bindAddress ?? INPUT_LOCAL.bindAddress,
    };
    const parsed = InputConfigSchema.safeParse(candidate);
    if (parsed.success) inputs.push(parsed.data);
    else invalid.push({ key: `i/${id}`, error: parsed.error.issues[0]?.message ?? 'invalid' });
  }

  return {
    desk: {
      ...local,
      name: pick('name', local.name),
      color: pick('color', local.color),
      grid: pick('grid', local.grid),
      widgets,
      network: { outputs, inputs },
    },
    invalid,
  };
}

/** Keys whose change affects the running network (an apply is needed). */
export const isNetworkKey = (key: string) => key.startsWith('o/') || key.startsWith('i/');
