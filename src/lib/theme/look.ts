// A look: what a desk looks like. Three choices: its colour palette, its ACTIVE colour (what
// pressed, on, filled and held widgets turn) and its widgets' skin. There is one look for every
// desk (GLOBAL SETTINGS › LOOK), and a desk can make any of the three its own (DESK › PRESET).
// A widget then picks one colour of its desk's palette (EDIT › VISUAL).
//
// All of it is per device, like the custom palettes and user skins it may point at: nothing here
// is in a preset or synced, so everyone sees a shared desk in their own look.
//
// Pure; the store is state/look.svelte.ts. App.svelte applies a look as CSS variables
// (`lookVars`): the one for every desk on :root, the desk's own around the desk.
import { z } from 'zod';
import { ColorIndex, CustomPaletteId, type CustomPalette } from '../model/preset';
import { BUILTIN_SKINS, DEFAULT_SKIN, type SkinInfo } from '../skins/builtin';
import {
  colorVars,
  DEFAULT_PALETTE,
  hasPalette,
  PALETTE_IDS,
  paletteVars,
  resolvePalette,
  type Palette,
} from './palettes';

/** The ACTIVE colour that is in no palette: the status green (`--ok`), the default. */
export const ACTIVE_GREEN = 'green';

/** A palette index, or the standard green. */
export const ActiveColor = z.union([ColorIndex, z.literal(ACTIVE_GREEN)]);
export type ActiveColor = z.infer<typeof ActiveColor>;

const PaletteRef = z.union([z.enum(PALETTE_IDS), CustomPaletteId]);
const SkinRef = z.string().min(1).max(64);

export interface Look {
  /** A built-in palette's id, or a custom one's. */
  palette: z.infer<typeof PaletteRef>;
  active: ActiveColor;
  /** A built-in skin's id, or a user skin's. */
  skin: string;
}
export type LookField = keyof Look;

export const DEFAULT_LOOK: Look = {
  palette: DEFAULT_PALETTE,
  active: ACTIVE_GREEN,
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
      active: ActiveColor.catch(DEFAULT_LOOK.active),
      skin: SkinRef.catch(DEFAULT_LOOK.skin),
    })
    .catch({ ...DEFAULT_LOOK }),
  desks: z
    .record(
      z.string(),
      z
        .object({
          palette: PaletteRef.optional().catch(undefined),
          active: ActiveColor.optional().catch(undefined),
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
  active: ActiveColor;
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

/** CSS colours of an ACTIVE colour, relative to the palette of wherever they are declared. */
export function activeVars(active: ActiveColor): { c: string; ink: string } {
  return active === ACTIVE_GREEN ? { c: 'var(--ok)', ink: 'var(--bg)' } : colorVars(active);
}

/** The ACTIVE colour of a look as a plain colour, for showing it outside the look. */
export function activeSwatch(look: ResolvedLook): string {
  return look.active === ACTIVE_GREEN ? 'var(--ok)' : look.palette.colors[look.active]!;
}

/** A look's CSS custom properties: its palette (`paletteVars`), `--active` and `--active-ink`. */
export function lookVars(look: ResolvedLook, accent: number): Record<string, string> {
  const active = activeVars(look.active);
  return {
    ...paletteVars(look.palette.colors, accent),
    '--active': active.c,
    '--active-ink': active.ink,
  };
}

/** CSS custom properties as a `style` attribute. */
export const cssText = (vars: Record<string, string>) =>
  Object.entries(vars)
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ');
