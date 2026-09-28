import { describe, expect, it } from 'vitest';
import type { CustomPalette } from '../model/preset';
import { BUILTIN_SKIN_LIST, BUILTIN_SKINS } from '../skins/builtin';
import {
  activeSwatch,
  cssText,
  DEFAULT_LOOK,
  LookSettingSchema,
  lookVars,
  resolveLook,
  type LookSetting,
} from './look';
import { PALETTE_SIZE, PALETTES } from './palettes';

const mine: CustomPalette = {
  id: 'custom-abc123',
  name: 'MINE',
  source: '#3cb4ff',
  colors: [...PALETTES.cobalt.colors],
  overridden: Array<boolean>(PALETTE_SIZE).fill(false),
};
const library = { custom: [mine], skins: BUILTIN_SKIN_LIST };
const setting = (over: Partial<LookSetting> = {}): LookSetting => ({
  global: { palette: 'sunset', active: 'green', skin: 'glass' },
  desks: {},
  ...over,
});

describe('resolving a look', () => {
  it('gives every desk the look of all desks', () => {
    const look = resolveLook(setting(), 'p-1', library);
    expect(look).toEqual(resolveLook(setting(), null, library));
    expect(look).toMatchObject({ paletteId: 'sunset', palette: PALETTES.sunset, active: 'green' });
    expect(look.skin).toBe(BUILTIN_SKINS.glass);
  });

  it('takes each of a desk’s own choices, and every desk’s for the rest', () => {
    const s = setting({ desks: { 'p-1': { palette: mine.id, active: 0 } } });
    const look = resolveLook(s, 'p-1', library);
    expect(look).toMatchObject({ paletteId: mine.id, palette: mine, active: 0 });
    expect(look.skin).toBe(BUILTIN_SKINS.glass);
    expect(resolveLook(s, 'p-2', library).paletteId).toBe('sunset');
  });

  it('passes over a palette or skin that is gone, down to RAINBOW and TERMINAL', () => {
    const s = setting({ desks: { 'p-1': { palette: 'custom-gone', skin: 'skin-gone' } } });
    expect(resolveLook(s, 'p-1', library).paletteId).toBe('sunset');
    expect(resolveLook(s, 'p-1', library).skin).toBe(BUILTIN_SKINS.glass);
    const gone = setting({ global: { palette: 'custom-gone', active: 3, skin: 'skin-gone' } });
    const look = resolveLook(gone, null, library);
    expect(look).toMatchObject({ paletteId: 'rainbow', palette: PALETTES.rainbow, active: 3 });
    expect(look.skin).toBe(BUILTIN_SKINS.terminal);
  });
});

describe('the saved look', () => {
  it('keeps what is valid when part of it is not', () => {
    expect(
      LookSettingSchema.parse({
        global: { palette: 'no-such', active: 12, skin: 'glass' },
        desks: { a: { palette: 'neon', active: 'blue' }, b: 'nope', c: { skin: '' } },
      }),
    ).toEqual({
      global: { ...DEFAULT_LOOK, skin: 'glass' },
      desks: { a: { palette: 'neon' } },
    });
    expect(LookSettingSchema.parse({})).toEqual({ global: DEFAULT_LOOK, desks: {} });
    expect(LookSettingSchema.parse({ global: 'x', desks: [] })).toEqual({
      global: DEFAULT_LOOK,
      desks: {},
    });
  });
});

describe('a look as CSS', () => {
  it('sets the palette, the accent and the ACTIVE colour', () => {
    const green = lookVars(resolveLook(setting(), null, library), 3);
    expect(green['--p9']).toBe(PALETTES.sunset.colors[9]);
    expect(green['--accent']).toBe(PALETTES.sunset.colors[3]);
    expect(green['--active']).toBe('var(--ok)');
    // A palette's ACTIVE colour is its variable, so it follows the look it is declared in.
    const own = setting({ desks: { d: { active: 4 } } });
    const vars = lookVars(resolveLook(own, 'd', library), 3);
    expect(vars['--active']).toBe('var(--p4)');
    expect(vars['--active-ink']).toBe('var(--p4-ink)');
    expect(cssText({ '--a': '1', '--b': 'x' })).toBe('--a: 1; --b: x');
  });

  it('shows the ACTIVE colour as a plain colour outside its look', () => {
    expect(activeSwatch(resolveLook(setting(), null, library))).toBe('var(--ok)');
    const own = setting({ desks: { d: { active: 4 } } });
    expect(activeSwatch(resolveLook(own, 'd', library))).toBe(PALETTES.sunset.colors[4]);
  });
});
