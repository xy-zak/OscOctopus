import { describe, expect, it } from 'vitest';
import { generatePalette, hexToLch, lchToHex, normalizeHex, regenerate } from './generate';
import { DEFAULT_ACCENT, PALETTE_SIZE } from './palettes';

const SOURCES = [
  '#3cb4ff',
  '#ff0000',
  '#0000ff',
  '#ffd23f',
  '#39ff14',
  '#9a5cff',
  '#c28f6b',
  '#808080',
  '#ffe4ec',
  '#1a1a40',
  '#ffffff',
  '#000000',
];

describe('normalizeHex', () => {
  it('accepts #rgb and #rrggbb, with or without #, in any case', () => {
    expect(normalizeHex('#3CB4FF')).toBe('#3cb4ff');
    expect(normalizeHex('3cb4ff')).toBe('#3cb4ff');
    expect(normalizeHex(' #fa0 ')).toBe('#ffaa00');
    expect(normalizeHex('#12345')).toBeNull();
    expect(normalizeHex('red')).toBeNull();
  });
});

describe('OKLCH conversion', () => {
  it('round-trips sRGB colours exactly', () => {
    for (const hex of SOURCES) expect(lchToHex(hexToLch(hex))).toBe(hex);
  });
  it('brings an impossible colour into sRGB, keeping its lightness', () => {
    const hex = lchToHex({ L: 0.9, C: 0.4, h: 260 });
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(hexToLch(hex).L).toBeCloseTo(0.9, 2);
  });
});

describe('generatePalette', () => {
  it('makes ten distinct colours, lightest first, the source among them exactly', () => {
    for (const src of SOURCES) {
      const p = generatePalette(src);
      expect(p, src).toHaveLength(PALETTE_SIZE);
      for (const c of p) expect(c).toMatch(/^#[0-9a-f]{6}$/);
      expect(new Set(p).size, src).toBe(PALETTE_SIZE);
      expect(p, src).toContain(src);
      const L = p.map((c) => hexToLch(c).L);
      for (let i = 1; i < L.length; i++) expect(L[i]!, `${src} #${i}`).toBeLessThan(L[i - 1]!);
    }
  });

  it('puts the source at colour 5 (the default accent) unless it is nearly white or black', () => {
    for (const src of ['#3cb4ff', '#ff0000', '#0000ff', '#ffd23f', '#808080', '#c28f6b']) {
      expect(generatePalette(src).indexOf(src), src).toBe(DEFAULT_ACCENT);
    }
    expect(generatePalette('#ffffff').indexOf('#ffffff')).toBe(0);
    expect(generatePalette('#000000').indexOf('#000000')).toBe(PALETTE_SIZE - 1);
  });

  it('drifts the lights towards yellow and the darks towards violet', () => {
    // Blue: lights go towards cyan (a lower hue), darks towards violet (a higher one).
    const blue = generatePalette('#3cb4ff').map((c) => hexToLch(c).h);
    expect(blue[1]!).toBeLessThan(blue[DEFAULT_ACCENT]!);
    expect(blue[9]!).toBeGreaterThan(blue[DEFAULT_ACCENT]!);
    // Red: lights go towards orange (higher), darks the short way round to purple (below 0°).
    const red = generatePalette('#ff0000').map((c) => hexToLch(c).h);
    expect(red[1]!).toBeGreaterThan(red[DEFAULT_ACCENT]!);
    expect(red[9]!).toBeGreaterThan(300);
  });

  it('keeps a grey source grey', () => {
    for (const c of generatePalette('#808080')) expect(hexToLch(c).C).toBeLessThan(0.01);
  });

  it('never goes so dark that a colour disappears on the dark background', () => {
    for (const src of ['#3cb4ff', '#ff0000', '#0000ff', '#9a5cff']) {
      for (const c of generatePalette(src)) expect(hexToLch(c).L, src).toBeGreaterThan(0.3);
    }
  });

  it('treats a bad source as mid grey rather than failing', () => {
    expect(generatePalette('nope')).toEqual(generatePalette('#808080'));
  });
});

describe('regenerate', () => {
  it('keeps colours picked by hand and regenerates the rest from the new source', () => {
    const picked = generatePalette('#3cb4ff');
    picked[2] = '#123456';
    const overridden = picked.map((_, i) => i === 2);
    const next = regenerate('#ff0000', picked, overridden);
    const fresh = generatePalette('#ff0000');
    expect(next[2]).toBe('#123456');
    expect(next.filter((_, i) => i !== 2)).toEqual(fresh.filter((_, i) => i !== 2));
  });
});
