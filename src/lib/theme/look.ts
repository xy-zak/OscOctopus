// A look: what a desk looks like. Three choices: its colour palette, its ACTIVE colour (what
// pressed, on, filled and held widgets turn: any colour, green by default) and its widgets'
// skin. There is one look for every desk (GLOBAL SETTINGS › LOOK), and a desk can make any of
// the three its own (DESK › LOOK). A widget then picks one colour of its desk's palette
// (EDIT › VISUAL).
//
// All of it is per device, like the custom palettes and user skins it may point at: nothing here
// is in a preset or synced, so everyone sees a shared desk in their own look.
//
// Pure; the store is state/look.svelte.ts. App.svelte applies a look as CSS variables
// (`lookVars`): the one for every desk on :root, the desk's own around the desk.
import { z } from 'zod';
import { CustomPaletteId, HexColor, type CustomPalette } from '../model/preset';
import { BUILTIN_SKINS, DEFAULT_SKIN, type SkinInfo } from '../skins/builtin';
import {
  DEFAULT_PALETTE,
  hasPalette,
  inkFor,
  PALETTE_IDS,
  paletteVars,
  resolvePalette,
  type Palette,
} from './palettes';

/** The default ACTIVE colour: the status green of the dark background (`--ok`). */
export const DEFAULT_ACTIVE = '#5fd787';

const PaletteRef = z.union([z.enum(PALETTE_IDS), CustomPaletteId]);
const SkinRef = z.string().min(1).max(64);

export interface Look {
  /** A built-in palette's id, or a custom one's. */
  palette: z.infer<typeof PaletteRef>;
  /** The ACTIVE colour, as #rrggbb. */
  active: string;
  /** A built-in skin's id, or a user skin's. */
  skin: string;
}
export type LookField = keyof Look;

export const DEFAULT_LOOK: Look = {
  palette: DEFAULT_PALETTE,
  active: DEFAULT_ACTIVE,
  skin: DEFAULT_SKIN,
};

/** A desk's own choices. What it leaves out is the look of every desk. */
export type DeskLook = Partial<Look>;

const defined = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/** The saved choice (setting `look`). Each field falls back on its own, so one bad entry never
 *  costs the rest. */
export const LookSettingSchema = z.object({
  global: z
    .object({
      palette: PaletteRef.catch(DEFAULT_LOOK.palette),
      active: HexColor.catch(DEFAULT_LOOK.active),
      skin: SkinRef.catch(DEFAULT_LOOK.skin),
    })
    .catch({ ...DEFAULT_LOOK }),
  desks: z
    .record(
      z.string(),
      z
        .object({
          palette: PaletteRef.optional().catch(undefined),
          active: HexColor.optional().catch(undefined),
          skin: SkinRef.optional().catch(undefined),
        })
        .catch({})
        .transform((d): DeskLook => defined(d)),
    )
    .transform((desks) =>
      Object.fromEntries(Object.entries(desks).filter(([, d]) => Object.keys(d).length > 0)),
    )
    .catch({}),
});
export interface LookSetting {
  global: Look;
  desks: Record<string, DeskLook>;
}

/** What this device has to pick from besides the built-in palettes. */
export interface LookLibrary {
  custom: readonly CustomPalette[];
  /** Every skin, built-in ones included. */
  skins: readonly SkinInfo[];
}

/** A look as it is drawn: the palette and skin found, not just named. */
export interface ResolvedLook {
  /** The palette's id: the one chosen, or the one that stands in for a palette that is gone. */
  paletteId: string;
  palette: Palette;
  active: string;
  skin: SkinInfo;
}

/**
 * The look of a desk (`deskId`), or of every desk (`null`). Each choice is the desk's own if it
 * made one, else every desk's. A palette or skin that is gone (deleted, or made on another
 * device) is passed over the same way, down to RAINBOW and TERMINAL.
 */
export function resolveLook(
  setting: LookSetting,
  deskId: string | null,
  library: LookLibrary,
): ResolvedLook {
  const own = deskId === null ? {} : (setting.desks[deskId] ?? {});
  const paletteId =
    [own.palette, setting.global.palette].find(
      (id): id is string => id !== undefined && hasPalette(id, library.custom),
    ) ?? DEFAULT_PALETTE;
  const skinId = [own.skin, setting.global.skin].find((id) =>
    library.skins.some((s) => s.id === id),
  );
  return {
    paletteId,
    palette: resolvePalette(paletteId, library.custom),
    active: own.active ?? setting.global.active,
    skin: library.skins.find((s) => s.id === skinId) ?? BUILTIN_SKINS[DEFAULT_SKIN],
  };
}

/** A look's CSS custom properties: its palette (`paletteVars`), `--active` and `--active-ink`. */
export function lookVars(look: ResolvedLook): Record<string, string> {
  return {
    ...paletteVars(look.palette.colors),
    '--active': look.active,
    '--active-ink': inkFor(look.active),
  };
}

/** CSS custom properties as a `style` attribute. */
export const cssText = (vars: Record<string, string>) =>
  Object.entries(vars)
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ');
