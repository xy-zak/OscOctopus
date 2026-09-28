// The skins that ship with the app. Each one's look is a stylesheet keyed on
// `.frame[data-base='<id>']` (skins/<id>.css); user skins (schema.ts) build on one of these as
// their `base`. Pure; the store that picks one is state/skins.svelte.ts.
import type { Skin } from './schema';

export const BUILTIN_SKIN_IDS = [
  'terminal',
  'glass',
  'sketch',
  'wobbly',
  'pixelated',
  'hardware',
  'neon',
  'blueprint',
  'brutalist',
  'led',
  'crt',
  'arcade',
] as const;
export type BuiltinSkinId = (typeof BUILTIN_SKIN_IDS)[number];

/**
 * What a skin needs from the components beyond CSS:
 *   keycap  bevel: keys stand out of the panel, with walls and edges (TERMINAL);
 *           flat: just the key's face (GLASS, SKETCH), which also skips the walls' elements
 *
 * Deliberately not a skin's to choose (docs/SKINS.md): the font, where titles and values go,
 * and the markers (fader scale, ON/OFF, pad numbers). They are the same in every skin, so a
 * desk reads the same whatever it wears.
 */
export interface SkinParams {
  keycap: 'bevel' | 'flat';
}

export interface SkinInfo {
  id: string;
  /** Shown in LOOK, like palette names: short and uppercase. */
  name: string;
  /** The built-in skin whose stylesheet draws it. */
  base: BuiltinSkinId;
  /** What it looks like, for the picker. */
  note: string;
  params: SkinParams;
  /** Made on this device (a file in the skins directory), not built in. */
  user?: boolean;
}

export const DEFAULT_SKIN: BuiltinSkinId = 'terminal';

/** Each built-in skin's name, note and params; its id is also its `base`. */
const LOOKS: Record<BuiltinSkinId, Omit<SkinInfo, 'id' | 'base'>> = {
  terminal: {
    name: 'TERMINAL',
    note: 'Pixel lines in the widget colour, hard shadows, dither fills and stepped motion',
    params: { keycap: 'bevel' },
  },
  glass: {
    name: 'GLASS',
    note: 'Clear, rounded panes tinted with the widget colour, lit along the top edge',
    params: { keycap: 'flat' },
  },
  sketch: {
    name: 'SKETCH',
    note: 'Coloured pencil on paper: hand-drawn outlines and hatching',
    params: { keycap: 'flat' },
  },
  wobbly: {
    name: 'WOBBLY',
    note: 'Clean and flat, every line an even wave',
    params: { keycap: 'flat' },
  },
  pixelated: {
    name: 'PIXELATED',
    note: 'An 8-bit game screen: chunky pixels, notched borders, bevelled blocks',
    params: { keycap: 'flat' },
  },
  hardware: {
    name: 'HARDWARE',
    note: 'A mixing desk: metal panels, rubber keys, ridged fader caps, LEDs',
    params: { keycap: 'flat' },
  },
  neon: {
    name: 'NEON',
    note: 'Glowing tubes on a dark wall: every line lit, fills hollow',
    params: { keycap: 'flat' },
  },
  blueprint: {
    name: 'BLUEPRINT',
    note: 'A technical drawing: hairlines, section hatching, centre lines',
    params: { keycap: 'flat' },
  },
  brutalist: {
    name: 'BRUTALIST',
    note: 'Thick borders, hard offset shadows, flat blocks of colour',
    params: { keycap: 'flat' },
  },
  led: {
    name: 'LED MATRIX',
    note: 'A grid of round LEDs: dotted borders, parts lit dot by dot',
    params: { keycap: 'flat' },
  },
  crt: {
    name: 'CRT',
    note: 'An old monitor: scanlines, a vignette, glow and phosphor trails',
    params: { keycap: 'flat' },
  },
  arcade: {
    name: 'ARCADE',
    note: 'A cabinet panel: domed buttons in chrome rings, ball-top levers',
    params: { keycap: 'flat' },
  },
};

export const BUILTIN_SKINS = Object.fromEntries(
  BUILTIN_SKIN_IDS.map((id) => [id, { id, base: id, ...LOOKS[id] }]),
) as Record<BuiltinSkinId, SkinInfo>;

/** The built-in skins in picker order. */
export const BUILTIN_SKIN_LIST: readonly SkinInfo[] = BUILTIN_SKIN_IDS.map(
  (id) => BUILTIN_SKINS[id],
);

/** A user skin as the picker and the widgets see it: its base skin, with its own changes. */
export function userSkinInfo(skin: Skin): SkinInfo {
  const base = BUILTIN_SKINS[skin.base];
  return {
    id: skin.id,
    name: skin.name.toUpperCase(),
    base: skin.base,
    note: `Your skin, based on ${base.name}`,
    params: { keycap: skin.keycap ?? base.params.keycap },
    user: true,
  };
}

/** A skin by id, or TERMINAL when there is none by that id (e.g. one that was deleted). */
export function resolveSkin(id: string | null | undefined, available: readonly SkinInfo[]) {
  return available.find((s) => s.id === id) ?? BUILTIN_SKINS[DEFAULT_SKIN];
}
