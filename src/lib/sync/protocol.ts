// What sync peers say to each other, validated with zod on arrival. Rust only checks the
// envelope (kind, desk id, size cap, well-formed JSON), so every body is untrusted until it
// passes these schemas. What a desk record's values may be is checked per key (paths.ts);
// widget values per widget type (`WidgetDef.isValue`).
import { z } from 'zod';
import type { AppKind } from '../ipc/types';
import { IdSchema } from '../model/preset';

/** A device id: the first 8 bytes of the hash of its key, in hex. */
export const PeerIdSchema = z.string().regex(/^[0-9a-f]{16}$/);

/** A desk record's lineage: a desk only merges with records of the same `doc`. */
export const DocIdSchema = z.string().regex(/^[0-9a-f]{16,32}$/);

/**
 * A hybrid logical clock stamp: wall time (ms), a counter for events within one ms, and the
 * device that made it (the tie-breaker). See hlc.ts.
 */
export const StampSchema = z.tuple([
  z.number().int().nonnegative(),
  z.number().int().min(0).max(0xffff),
  PeerIdSchema,
]);
export type Stamp = z.infer<typeof StampSchema>;

/** A desk record key, e.g. `name`, `w/fader1/rect`, `o/out1/cfg` (see paths.ts). */
export const KeySchema = z
  .string()
  .max(200)
  .regex(/^[A-Za-z0-9_/#-]+$/);

/** One entry of a desk record: `[key, stamp, value]`, or `[key, stamp]` for a deletion. */
export const EntrySchema = z.union([
  z.tuple([KeySchema, StampSchema]),
  z.tuple([KeySchema, StampSchema, z.unknown()]),
]);
export type WireEntry = z.infer<typeof EntrySchema>;

/** One live value register: `[widgetId or widgetId#pad, stamp, value]`. */
export const RegisterSchema = z.tuple([KeySchema, StampSchema, z.unknown()]);
export type WireRegister = z.infer<typeof RegisterSchema>;

export const MAX_ENTRIES = 50_000;
export const MAX_OPS = 10_000;
export const MAX_REGISTERS = 4096;
/** The most widgets one presence says are selected. */
export const MAX_EDITING = 256;

export const PresenceSchema = z.object({
  /** The desk on screen. */
  viewing: IdSchema.nullable(),
  /** The widgets selected (one open in the Inspector, or several): a soft lock others see. */
  editing: z
    .object({ desk: IdSchema, widgets: z.array(IdSchema).min(1).max(MAX_EDITING) })
    .nullable(),
  /** Shared desks whose received OSC input this device forwards. */
  forwarding: z.array(IdSchema).max(64),
  /** Peers this device is connected to, so others can spot missing links. */
  neighbours: z.array(PeerIdSchema).max(64),
  /** LOCKED here: remote edits wait until unlocked. */
  locked: z.boolean(),
});
export type Presence = z.infer<typeof PresenceSchema>;

export const DeskAnnounceSchema = z.object({
  desks: z.array(z.object({ id: IdSchema, doc: DocIdSchema, name: z.string().max(200) })).max(64),
});
export type DeskAnnounce = z.infer<typeof DeskAnnounceSchema>;

export const DeskRequestSchema = z.object({ doc: DocIdSchema });
export type DeskRequest = z.infer<typeof DeskRequestSchema>;

export const DeskStateSchema = z.object({
  doc: DocIdSchema,
  entries: z.array(EntrySchema).max(MAX_ENTRIES),
  values: z.array(RegisterSchema).max(MAX_REGISTERS),
});
export type DeskState = z.infer<typeof DeskStateSchema>;

export const DeskOpsSchema = z.object({
  doc: DocIdSchema,
  ops: z.array(EntrySchema).min(1).max(MAX_OPS),
});
export type DeskOps = z.infer<typeof DeskOpsSchema>;

export const DeskDigestSchema = z.object({
  doc: DocIdSchema,
  digest: z.string().regex(/^[0-9a-f]{8,64}$/),
  count: z.number().int().nonnegative(),
});
export type DeskDigest = z.infer<typeof DeskDigestSchema>;

export const ValuesSchema = z.object({
  doc: DocIdSchema,
  regs: z.array(RegisterSchema).max(MAX_REGISTERS),
});
export type Values = z.infer<typeof ValuesSchema>;

export interface Bodies {
  presence: Presence;
  deskAnnounce: DeskAnnounce;
  deskRequest: DeskRequest;
  deskState: DeskState;
  deskOps: DeskOps;
  deskDigest: DeskDigest;
  values: Values;
}

const SCHEMAS: { [K in AppKind]: z.ZodType<Bodies[K]> } = {
  presence: PresenceSchema,
  deskAnnounce: DeskAnnounceSchema,
  deskRequest: DeskRequestSchema,
  deskState: DeskStateSchema,
  deskOps: DeskOpsSchema,
  deskDigest: DeskDigestSchema,
  values: ValuesSchema,
};

/** The body if it is valid for its kind, else the reason it isn't. */
export function parseBody<K extends AppKind>(
  kind: K,
  body: unknown,
): { ok: true; body: Bodies[K] } | { ok: false; error: string } {
  const result = SCHEMAS[kind].safeParse(body);
  if (result.success) return { ok: true, body: result.data };
  const issue = result.error.issues[0];
  return { ok: false, error: `${issue?.path.join('.') || 'body'}: ${issue?.message ?? 'invalid'}` };
}
