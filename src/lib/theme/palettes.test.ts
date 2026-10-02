import { describe, expect, it } from 'vitest';
import { ThemeSchema, type CustomPalette, type Theme } from '../model/preset';
import {
  ACCENT_INDEX,
  hasPalette,
  INK_DARK,
  inkFor,
  luminance,
  nearestIndex,
  PALETTE_IDS,
  PALETTE_SIZE,
  PALETTES,
  paletteVars,
  resolvePalette,
  swatchOf,
  withCustomPalette,
  withoutCustomPalette,
} from './palettes';

describe('palettes', () => {
  it('has every theme, ten distinct valid colours each', () => {
    expect(PALETTE_IDS).toEqual([
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
    ]);
    for (const id of PALETTE_IDS) {
      const { colors } = PALETTES[id];
      expect(colors).toHaveLength(PALETTE_SIZE);
      expect(new Set(colors).size).toBe(PALETTE_SIZE);
      for (const c of colors) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
  it('ends each with an accent that shows on the dark background', () => {
    expect(ACCENT_INDEX).toBe(PALETTE_SIZE - 1);
    const contrast = (hex: string) => (luminance(hex) + 0.05) / (luminance(INK_DARK) + 0.05);
    for (const id of PALETTE_IDS) {
      expect(contrast(PALETTES[id].colors[ACCENT_INDEX]!), id).toBeGreaterThan(4.5);
    }
  });
  it('picks readable ink for reverse video', () => {
    expect(inkFor('#fafafa')).toBe('#0b0b0c');
    expect(inkFor('#4a4a4a')).toBe('#f2f0eb');
  });
  it('finds the nearest colour', () => {
    expect(nearestIndex('#ff0000', 'rainbow')).toBe(0);
    expect(nearestIndex('#fff', 'greyscale')).toBe(ACCENT_INDEX);
    expect(nearestIndex('not a colour', 'neon')).toBe(0);
  });
  it('emits CSS variables for every colour and the accent, its last', () => {
    const v = paletteVars(PALETTES.neon.colors);
    expect(v['--p3']).toBe(PALETTES.neon.colors[3]);
    expect(v['--accent']).toBe(PALETTES.neon.colors[ACCENT_INDEX]);
    expect(v['--accent-ink']).toBe(inkFor(PALETTES.neon.colors[ACCENT_INDEX]!));
  });
  it('gives a palette colour as plain colours, for outside its look', () => {
    expect(swatchOf(PALETTES.neon, 2)).toEqual({
      c: PALETTES.neon.colors[2],
      ink: inkFor(PALETTES.neon.colors[2]!),
    });
  });
});

describe('theme mode', () => {
  it('defaults to dark, including for themes saved before light mode existed', () => {
    expect(ThemeSchema.parse({}).mode).toBe('dark');
    expect(ThemeSchema.parse({ mode: 'light' }).mode).toBe('light');
    expect(ThemeSchema.safeParse({ mode: 'sepia' }).success).toBe(false);
  });
  it('still loads a theme saved when it named the palette and an accent (now the palette’s)', () => {
    expect(ThemeSchema.parse({ palette: 'neon', accent: 2 })).toEqual({
      mode: 'dark',
      custom: [],
    });
  });
});

const mine: CustomPalette = {
  id: 'custom-abc123',
  name: 'MINE',
  source: '#3cb4ff',
  colors: [...PALETTES.cobalt.colors],
  overridden: Array<boolean>(PALETTE_SIZE).fill(false),
};

describe('custom palettes', () => {
  const theme: Theme = { mode: 'dark', custom: [] };

  it('are found by id; a missing one shows as RAINBOW', () => {
    expect(resolvePalette('sunset', [mine])).toBe(PALETTES.sunset);
    expect(resolvePalette(mine.id, [mine])).toBe(mine);
    expect(resolvePalette('custom-gone', [mine])).toBe(PALETTES.rainbow);
    expect(hasPalette('sunset', [])).toBe(true);
    expect(hasPalette(mine.id, [mine])).toBe(true);
    expect(hasPalette('custom-gone', [mine])).toBe(false);
  });

  it('are added, replaced by id, and removed', () => {
    const added = withCustomPalette(theme, mine);
    expect(added.custom).toEqual([mine]);
    const renamed = withCustomPalette(added, { ...mine, name: 'OTHER' });
    expect(renamed.custom.map((p) => p.name)).toEqual(['OTHER']);
    expect(withoutCustomPalette(added, mine.id)).toEqual(theme);
  });

  it('are validated when a saved theme loads; themes saved before them have none', () => {
    expect(ThemeSchema.parse({ mode: 'dark' }).custom).toEqual([]);
    expect(ThemeSchema.safeParse({ ...theme, custom: [mine] }).success).toBe(true);
    const valid = (patch: Partial<CustomPalette>) =>
      ThemeSchema.safeParse({ ...theme, custom: [{ ...mine, ...patch }] }).success;
    expect(valid({ colors: mine.colors.slice(0, 9) })).toBe(false);
    expect(valid({ colors: ['red', ...mine.colors.slice(1)] })).toBe(false);
    expect(valid({ name: '' })).toBe(false);
    expect(valid({ name: 'A'.repeat(13) })).toBe(false);
    expect(valid({ id: 'rainbow' })).toBe(false);
  });
});
