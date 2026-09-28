// Colour palettes. The UI itself is always near-black on near-white; palettes only colour
// active things (fills, lit buttons, switches, cursors). Each palette has exactly ten colours,
// so a widget's colour is just an index 0–9 and switching palette recolours the whole desk
// (which palette a desk uses is its look, look.ts).
// Two kinds. RAINBOW, NEON and PASTEL run through every hue. The themed ones are heavily
// inspired by one colour but travel across its neighbouring hues (SUNSET goes yellow → orange →
// pink → purple), so their colours stay distinct; most end with two contrasting accents
// (indices 8 and 9, like UNDERWATER's pink and peach). GREYSCALE is pure grey. The picker lists
// the themed ones around the colour wheel. Index 5, the default accent, is a clear mid colour in
// each. Some follow the look of other software (a green-screen terminal, VS Code themes); hover
// one in the picker to see which. Custom palettes, made in LOOK from one colour (generate.ts),
// are listed after these; `resolvePalette` finds either kind.
import type { CustomPalette, Theme } from '../model/preset';

export const PALETTE_IDS = [
  'rainbow',
  'neon',
  'pastel',
  'crimson',
  'sunset',
  'amber',
  'phosphor',
  'underwater',
  'frost',
  'cobalt',
  'violet',
  'sakura',
  'sand',
  'greyscale',
] as const;
export type PaletteId = (typeof PALETTE_IDS)[number];

export const PALETTE_SIZE = 10;

/** The palette of a fresh install, and the one shown in place of a deleted custom palette. */
export const DEFAULT_PALETTE: PaletteId = 'rainbow';

/** Palette index of the default accent, also the first desk's identity colour. */
export const DEFAULT_ACCENT = 5;

export interface Palette {
  name: string;
  colors: readonly string[];
  /** What it follows, if anything. */
  note?: string;
}

export const PALETTES: Record<PaletteId, Palette> = {
  rainbow: {
    name: 'RAINBOW',
    colors: [
      '#ff5c5c',
      '#ff9a3c',
      '#ffd23f',
      '#b8f13c',
      '#3ce68a',
      '#2ee6d6',
      '#3cb4ff',
      '#6b7bff',
      '#b06bff',
      '#ff6bd6',
    ],
  },
  neon: {
    name: 'NEON',
    colors: [
      '#ff2a6d',
      '#ff6f1a',
      '#fff01f',
      '#39ff14',
      '#05ffa1',
      '#01f9ff',
      '#1b9cfc',
      '#7b61ff',
      '#bc13fe',
      '#ff10f0',
    ],
  },
  pastel: {
    name: 'PASTEL',
    colors: [
      '#ffadad',
      '#ffd6a5',
      '#fdffb6',
      '#caffbf',
      '#b5ead7',
      '#9bf6ff',
      '#a0c4ff',
      '#bdb2ff',
      '#e0bbff',
      '#ffc6ff',
    ],
  },
  sunset: {
    name: 'SUNSET',
    colors: [
      '#ffe29a',
      '#ffc15e',
      '#ff9f5a',
      '#ff7b54',
      '#ff5e62',
      '#ef476f',
      '#d6336c',
      '#b83280',
      '#9b4dca',
      '#6c63ff',
    ],
  },
  greyscale: {
    name: 'GREYSCALE',
    colors: [
      '#fafafa',
      '#e4e4e4',
      '#cfcfcf',
      '#bababa',
      '#a5a5a5',
      '#909090',
      '#7b7b7b',
      '#686868',
      '#585858',
      '#4a4a4a',
    ],
  },
  underwater: {
    name: 'UNDERWATER',
    colors: [
      '#e0fbfc',
      '#aef6ff',
      '#80ffdb',
      '#48e5c2',
      '#2ec4b6',
      '#00b4d8',
      '#3a86ff',
      '#8e7dff',
      '#ff8fab',
      '#ffd6a5',
    ],
  },
  phosphor: {
    name: 'PHOSPHOR',
    note: 'Terminal greens, from lime through green to teal, with amber and copper',
    colors: [
      '#f0ffa8',
      '#cfff5e',
      '#9cf23f',
      '#5cff78',
      '#2fe07a',
      '#19c98f',
      '#16b8a8',
      '#1fa2c4',
      '#ffb000',
      '#ff6b4a',
    ],
  },
  amber: {
    name: 'AMBER',
    note: 'Amber-terminal golds, from cream through honey to rust, with cyan and green',
    colors: [
      '#fff6cc',
      '#ffe58f',
      '#ffd24d',
      '#ffb000',
      '#f29b1d',
      '#dd8a2e',
      '#c9743a',
      '#b35f3a',
      '#3ad6ff',
      '#7cff8a',
    ],
  },
  crimson: {
    name: 'CRIMSON',
    note: 'Reds, from coral through crimson and raspberry to plum, with gold and teal',
    colors: [
      '#ffb3a7',
      '#ff8a80',
      '#ff5c5c',
      '#f23a4f',
      '#d92b5a',
      '#c2256e',
      '#a8237f',
      '#8a2a8f',
      '#ffd23f',
      '#2ee6c8',
    ],
  },
  sakura: {
    name: 'SAKURA',
    note: 'Spring pinks, from blossom through orchid to lavender, with leaf green and sky',
    colors: [
      '#ffe4ec',
      '#ffc6d9',
      '#ffa3c4',
      '#ff85b3',
      '#f76fa8',
      '#e56bc2',
      '#c77ddb',
      '#a58cf0',
      '#9be36b',
      '#8fd3ff',
    ],
  },
  violet: {
    name: 'VIOLET',
    note: 'Purples, from orchid through violet to periwinkle, with the yellow and aqua of the Shades of Purple theme (VS Code)',
    colors: [
      '#ffb3f0',
      '#f28cff',
      '#d86bff',
      '#b85cff',
      '#9a5cff',
      '#7c61ff',
      '#6272ff',
      '#5a85ff',
      '#fad000',
      '#9effff',
    ],
  },
  cobalt: {
    name: 'COBALT',
    note: 'Blues, from ice through cobalt to indigo, with the yellow and pink of the Cobalt2 theme (VS Code)',
    colors: [
      '#b8f0ff',
      '#8adfff',
      '#5cc8ff',
      '#3aa6ff',
      '#2b86ff',
      '#3d6bff',
      '#5a5cff',
      '#7a55f0',
      '#ffc600',
      '#ff628c',
    ],
  },
  frost: {
    name: 'FROST',
    note: 'Muted arctic blues and frost, after Nord, with its aurora yellow and purple',
    colors: [
      '#e5f0f5',
      '#c9dde6',
      '#a9ccd9',
      '#8fbcbb',
      '#88c0d0',
      '#81a1c1',
      '#6f8fbf',
      '#5e81ac',
      '#ebcb8b',
      '#b48ead',
    ],
  },
  sand: {
    name: 'SAND',
    note: 'Desert: bone, wheat, ochre, clay and sage, with turquoise and sky',
    colors: [
      '#f7efdc',
      '#efdcb4',
      '#e2c48c',
      '#d1a871',
      '#c28f6b',
      '#b07c73',
      '#9fae88',
      '#7fa6a0',
      '#34c3b5',
      '#6fa8dc',
    ],
  },
};

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', '').slice(0, 6).padEnd(6, '0'), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance, 0 (black) – 1 (white). */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const INK_DARK = '#0b0b0c';
export const INK_LIGHT = '#f2f0eb';

/** Text colour to put on top of a palette colour ("reverse video"). */
export function inkFor(hex: string): string {
  return luminance(hex) > 0.2 ? INK_DARK : INK_LIGHT;
}

/** Index of the palette colour closest to an arbitrary CSS hex colour (for migrations). */
export function nearestIndex(hex: string, palette: PaletteId): number {
  if (!/^#?[0-9a-f]{3,8}$/i.test(hex)) return 0;
  const full =
    hex.replace('#', '').length === 3
      ? hex.replace('#', '').replace(/./g, '$&$&')
      : hex.replace('#', '');
  const [r, g, b] = rgb(full);
  let best = 0;
  let bestD = Infinity;
  PALETTES[palette].colors.forEach((c, i) => {
    const [cr, cg, cb] = rgb(c);
    const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

export const isBuiltIn = (id: string): id is PaletteId =>
  (PALETTE_IDS as readonly string[]).includes(id);

/** Whether there is a palette by that id: a built-in one, or one of the custom ones. */
export const hasPalette = (id: string, custom: readonly CustomPalette[]) =>
  isBuiltIn(id) || custom.some((p) => p.id === id);

/** A palette by id: built-in, or one of the custom ones. One that was deleted is RAINBOW. */
export function resolvePalette(id: string, custom: readonly CustomPalette[]): Palette {
  if (isBuiltIn(id)) return PALETTES[id];
  return custom.find((p) => p.id === id) ?? PALETTES[DEFAULT_PALETTE];
}

/** The theme with `palette` added, or replacing the custom palette with the same id. */
export function withCustomPalette(theme: Theme, palette: CustomPalette): Theme {
  const i = theme.custom.findIndex((p) => p.id === palette.id);
  const custom = [...theme.custom];
  if (i === -1) custom.push(palette);
  else custom[i] = palette;
  return { ...theme, custom };
}

/** The theme without that custom palette. */
export function withoutCustomPalette(theme: Theme, id: string): Theme {
  return { ...theme, custom: theme.custom.filter((p) => p.id !== id) };
}

/** CSS custom properties for a palette's colours: --p0…--p9, their inks, and the accent. */
export function paletteVars(colors: readonly string[], accent: number): Record<string, string> {
  const vars: Record<string, string> = {};
  colors.forEach((c, i) => {
    vars[`--p${i}`] = c;
    vars[`--p${i}-ink`] = inkFor(c);
  });
  vars['--accent'] = colors[accent] ?? colors[0]!;
  vars['--accent-ink'] = inkFor(colors[accent] ?? colors[0]!);
  return vars;
}

/**
 * CSS colours for a palette index, in the palette of wherever they are used (the look around
 * it). `null` (AUTO) is the colour of the surrounding desk: `--auto-c` / `--auto-ink`, which the
 * desk's grid sets (GridCanvas). Outside a desk it falls back to the accent.
 */
export function colorVars(index: number | null): { c: string; ink: string } {
  return index === null
    ? { c: 'var(--auto-c, var(--accent))', ink: 'var(--auto-ink, var(--accent-ink))' }
    : { c: `var(--p${index})`, ink: `var(--p${index}-ink)` };
}

/** A colour of a given palette as plain colours, for showing it outside that palette's look
 *  (a desk's tab shows the desk's colour in the desk's own palette). */
export function swatchOf(palette: Palette, index: number): { c: string; ink: string } {
  const c = palette.colors[index] ?? palette.colors[0]!;
  return { c, ink: inkFor(c) };
}
