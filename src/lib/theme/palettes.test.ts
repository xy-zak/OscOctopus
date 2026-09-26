import { describe, expect, it } from 'vitest';
import { inkFor, nearestIndex, PALETTE_IDS, PALETTE_SIZE, PALETTES, paletteVars } from './palettes';

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
  it('picks readable ink for reverse video', () => {
    expect(inkFor('#fafafa')).toBe('#0b0b0c');
    expect(inkFor('#4a4a4a')).toBe('#f2f0eb');
  });
  it('finds the nearest colour', () => {
    expect(nearestIndex('#ff0000', 'rainbow')).toBe(0);
    expect(nearestIndex('#fff', 'greyscale')).toBe(0);
    expect(nearestIndex('not a colour', 'neon')).toBe(0);
  });
  it('emits CSS variables for every colour and the accent', () => {
    const v = paletteVars('neon', 3);
    expect(v['--p9']).toBe(PALETTES.neon.colors[9]);
    expect(v['--accent']).toBe(PALETTES.neon.colors[3]);
    expect(v['--accent-ink']).toBeDefined();
  });
});

describe('theme mode', () => {
  it('defaults to dark, including for themes saved before light mode existed', async () => {
    const { ThemeSchema } = await import('../model/preset');
    expect(ThemeSchema.parse({ palette: 'neon', accent: 2 }).mode).toBe('dark');
    expect(ThemeSchema.parse({ palette: 'neon', accent: 2, mode: 'light' }).mode).toBe('light');
    expect(ThemeSchema.safeParse({ palette: 'neon', accent: 2, mode: 'sepia' }).success).toBe(
      false,
    );
  });
});
