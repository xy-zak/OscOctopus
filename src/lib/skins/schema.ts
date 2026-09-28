// A user-made widget skin, as saved (<app data>/skins/<id>.json) and shared as a file. It builds
// on a built-in skin (`base`) and changes only what it lists: per part and state, fills, lines,
// corners, shadows, text colour and images; some geometry; the colour of the fader's scale.
// Never the typography, where titles, values and markers go, or the desk (docs/SKINS.md): the
// schema can't express them, and compile.ts turns it into CSS from enums and numbers only.
import { z } from 'zod';
import { HexColor } from '../model/preset';
import { MARKER_PARTS, PARTS, STATES, TOKENS, type PartName } from './anatomy';
import { BUILTIN_SKIN_IDS } from './builtin';

export const SKIN_FORMAT = 'oscoctopus-skin';

export const SKIN_LIMITS = {
  name: 16,
  /** Longest side of an embedded image, in px (larger ones are scaled down on import). */
  imageSide: 1024,
  /** One image's bytes (decoded), and all of a skin's images together. */
  imageBytes: 512 * 1024,
  imagesBytes: 6 * 1024 * 1024,
  images: 32,
} as const;

export const SkinId = z.string().regex(/^skin-[a-z0-9]{1,32}$/);
export const ImageRef = z.string().regex(/^img-[a-z0-9]{1,16}$/);

/** Colour roles a skin paints with (skins/base.css); they follow the palette and light mode. */
export const ROLES = [
  'c',
  'c-solid',
  'c-ink',
  'c-text',
  'w-bg',
  'act',
  'act-ink',
  'fg',
  'fg-dim',
  'fg-faint',
  'bg',
  'bg-2',
  'line',
  'shadow',
] as const;
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

const Alpha = z.number().min(0).max(1);
/** A palette role (preferred: it follows the widget and the mode) or a fixed colour. */
export const Paint = z.union([
  z.object({ role: Role, alpha: Alpha.default(1) }).strict(),
  z.object({ hex: HexColor, alpha: Alpha.default(1) }).strict(),
]);
export type Paint = z.infer<typeof Paint>;

export const TEXTURES = ['solid', 'dither50', 'dither25', 'hatch', 'crosshatch', 'dots'] as const;
export const Fill = z.object({ paint: Paint, texture: z.enum(TEXTURES).default('solid') }).strict();

export const Line = z
  .object({
    width: z.number().int().min(0).max(8),
    style: z.enum(['solid', 'dashed', 'dotted']).default('solid'),
    paint: Paint,
  })
  .strict();

/** drop: offset and blur · glow: all round · inset: inside the part. */
export const Shadow = z
  .object({
    kind: z.enum(['drop', 'glow', 'inset']),
    x: z.number().int().min(-16).max(16).default(0),
    y: z.number().int().min(-16).max(16).default(0),
    blur: z.number().int().min(0).max(32).default(0),
    paint: Paint,
  })
  .strict();

/** A nine-slice inset, in image px. */
const Slice = z.number().int().min(0).max(512);

/**
 * An image on a part: nine-slice (corners kept, edges and middle stretched), stretched,
 * cover/contain, or tiled. `tint` draws it in a colour role instead (the image is a mask: line
 * art in any colour takes the widget's colour). It sits under the part's contents, or over.
 */
export const ImageUse = z
  .object({
    ref: ImageRef,
    mode: z.enum(['nine', 'stretch', 'cover', 'contain', 'tile']),
    slice: z.tuple([Slice, Slice, Slice, Slice]).default([0, 0, 0, 0]),
    tint: Role.nullable().default(null),
    layer: z.enum(['under', 'over']).default('under'),
  })
  .strict();
export type ImageUse = z.infer<typeof ImageUse>;

/** What a skin changes on a part in one state. Anything left out stays the base skin's. */
export const Style = z
  .object({
    /** null: no fill. */
    fill: Fill.nullable().optional(),
    /** null: no line. */
    line: Line.nullable().optional(),
    radius: z.number().int().min(0).max(64).optional(),
    /** []: no shadow. */
    shadows: z.array(Shadow).max(3).optional(),
    text: Paint.optional(),
    opacity: z.number().min(0.1).max(1).optional(),
    image: ImageUse.nullable().optional(),
  })
  .strict();
export type Style = z.infer<typeof Style>;

export const STATE_KEYS = ['rest', ...STATES] as const;
export type StateKey = (typeof STATE_KEYS)[number];

export const IMAGE_MIMES = ['image/png', 'image/webp', 'image/jpeg', 'image/svg+xml'] as const;
export const SkinImage = z
  .object({
    mime: z.enum(IMAGE_MIMES),
    /** Base64 of the file's bytes. */
    data: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/),
    w: z.number().int().min(1).max(SKIN_LIMITS.imageSide),
    h: z.number().int().min(1).max(SKIN_LIMITS.imageSide),
  })
  .strict();
export type SkinImage = z.infer<typeof SkinImage>;

/** Lengths a skin may set (px); the fader scale's colour is `scale`, a paint. */
export const LENGTH_TOKENS = (Object.keys(TOKENS) as (keyof typeof TOKENS)[]).filter(
  (t) => t !== '--slider-tick-c',
);
const Tokens = z.partialRecord(
  z.enum(LENGTH_TOKENS as [string, ...string[]]),
  z.number().min(0).max(64),
);

const PartStyles = z.partialRecord(
  z.enum(Object.keys(PARTS) as [PartName, ...PartName[]]),
  z.partialRecord(z.enum(STATE_KEYS), Style),
);
export type PartStyles = z.infer<typeof PartStyles>;

const decodedBytes = (b64: string) => Math.floor((b64.length * 3) / 4);

export const SkinSchema = z
  .object({
    format: z.literal(SKIN_FORMAT),
    version: z.literal(1),
    id: SkinId,
    name: z.string().trim().min(1).max(SKIN_LIMITS.name),
    base: z.enum(BUILTIN_SKIN_IDS),
    /** Keys stand out (bevel) or are flat; the base skin's when left out. */
    keycap: z.enum(['bevel', 'flat']).optional(),
    tokens: Tokens.default({}),
    /** The fader scale's colour. */
    scale: Paint.optional(),
    parts: PartStyles.default({}),
    /** Changes for light mode only, on top of `parts`. */
    light: PartStyles.default({}),
    images: z.record(ImageRef, SkinImage).default({}),
  })
  .strict()
  .superRefine((skin, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    for (const group of ['parts', 'light'] as const) {
      for (const [part, states] of Object.entries(skin[group]) as [PartName, object][]) {
        const known = PARTS[part].states as Partial<Record<string, string>>;
        for (const [state, style] of Object.entries(states) as [StateKey, Style][]) {
          const at = [group, part, state];
          if (state !== 'rest' && !known[state]) issue(at, `${part} has no ${state} state`);
          if (MARKER_PARTS.has(part) && (style.opacity !== undefined || style.image)) {
            issue(at, `${part} is a marker: it takes no image or fade`);
          }
          const img = style.image;
          if (!img) continue;
          if (!skin.images[img.ref]) issue([...at, 'image'], `no image ${img.ref}`);
          const kind = PARTS[part].image as string;
          const ok =
            kind === 'region' ||
            (kind === 'glyph' && img.mode === 'contain') ||
            (kind === 'line' && (img.mode === 'tile' || img.mode === 'stretch'));
          if (!ok) issue([...at, 'image'], `${part} can't take a ${img.mode} image`);
        }
      }
    }
    if (Object.keys(skin.images).length > SKIN_LIMITS.images) issue(['images'], 'too many images');
    let total = 0;
    for (const [ref, img] of Object.entries(skin.images)) {
      const bytes = decodedBytes(img.data);
      total += bytes;
      if (bytes > SKIN_LIMITS.imageBytes) issue(['images', ref], 'image is too large');
    }
    if (total > SKIN_LIMITS.imagesBytes) issue(['images'], 'images are too large together');
  });
export type Skin = z.infer<typeof SkinSchema>;
