// Colour palettes. The UI itself is always near-black on near-white; palettes only colour
// active things (fills, lit buttons, switches, cursors). Each palette has exactly ten colours,
// so a widget's colour is just an index 0–9 and switching palette recolours the whole desk.

export const PALETTE_IDS = [
  'rainbow',
  'neon',
  'pastel',
  'sunset',
  'greyscale',
  'underwater',
] as const;
export type PaletteId = (typeof PALETTE_IDS)[number];

export const PALETTE_SIZE = 10;

/** Palette index of the default accent, also the first desk's identity colour. */
export const DEFAULT_ACCENT = 5;

export const PALETTES: Record<PaletteId, { name: string; colors: readonly string[] }> = {
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

/** CSS custom properties for a palette: --p0…--p9, their inks, and the accent. */
export function paletteVars(palette: PaletteId, accent: number): Record<string, string> {
  const colors = PALETTES[palette].colors;
  const vars: Record<string, string> = {};
  colors.forEach((c, i) => {
    vars[`--p${i}`] = c;
    vars[`--p${i}-ink`] = inkFor(c);
  });
  vars['--accent'] = colors[accent] ?? colors[0]!;
  vars['--accent-ink'] = inkFor(colors[accent] ?? colors[0]!);
  return vars;
}

/** Style values for something coloured by palette index (null = theme accent). */
export function colorVars(index: number | null): { c: string; ink: string } {
  return index === null
    ? { c: 'var(--accent)', ink: 'var(--accent-ink)' }
    : { c: `var(--p${index})`, ink: `var(--p${index}-ink)` };
}
