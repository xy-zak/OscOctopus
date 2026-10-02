import { describe, expect, it } from 'vitest';
import type { CustomPalette } from '../model/preset';
import { BUILTIN_SKIN_LIST, BUILTIN_SKINS } from '../skins/builtin';
import {
  cssText,
  DEFAULT_ACTIVE,
  DEFAULT_LOOK,
  LookSettingSchema,
  lookVars,
  resolveLook,
  type LookSetting,
} from './look';
import { inkFor, PALETTE_SIZE, PALETTES } from './palettes';

const mine: CustomPalette = {
  id: 'custom-abc123',
  name: 'MINE',
  source: '#3cb4ff',
  colors: [...PALETTES.cobalt.colors],
  overridden: Array<boolean>(PALETTE_SIZE).fill(false),
};
const library = { custom: [mine], skins: BUILTIN_SKIN_LIST };
const setting = (over: Partial<LookSetting> = {}): LookSetting => ({
  global: { palette: 'sunset', active: DEFAULT_ACTIVE, skin: 'glass' },
  desks: {},
  ...over,
});

describe('resolving a look', () => {
  it('gives every desk the look of all desks', () => {
    const look = resolveLook(setting(), 'p-1', library);
    expect(look).toEqual(resolveLook(setting(), null, library));
    expect(look).toMatchObject({
      paletteId: 'sunset',
      palette: PALETTES.sunset,
      active: DEFAULT_ACTIVE,
    });
    expect(look.skin).toBe(BUILTIN_SKINS.glass);
  });

  it('takes each of a desk’s own choices, and every desk’s for the rest', () => {
    const s = setting({ desks: { 'p-1': { palette: mine.id, active: '#ff0000' } } });
    const look = resolveLook(s, 'p-1', library);
    expect(look).toMatchObject({ paletteId: mine.id, palette: mine, active: '#ff0000' });
    expect(look.skin).toBe(BUILTIN_SKINS.glass);
    expect(resolveLook(s, 'p-2', library).paletteId).toBe('sunset');
  });

  it('passes over a palette or skin that is gone, down to RAINBOW and TERMINAL', () => {
    const s = setting({ desks: { 'p-1': { palette: 'custom-gone', skin: 'skin-gone' } } });
    expect(resolveLook(s, 'p-1', library).paletteId).toBe('sunset');
    expect(resolveLook(s, 'p-1', library).skin).toBe(BUILTIN_SKINS.glass);
    const gone = setting({
      global: { palette: 'custom-gone', active: '#123456', skin: 'skin-gone' },
    });
    const look = resolveLook(gone, null, library);
    expect(look).toMatchObject({
      paletteId: 'rainbow',
      palette: PALETTES.rainbow,
      active: '#123456',
    });
    expect(look.skin).toBe(BUILTIN_SKINS.terminal);
  });
});

describe('the saved look', () => {
  it('keeps what is valid when part of it is not', () => {
    expect(
      LookSettingSchema.parse({
        global: { palette: 'no-such', active: 'green', skin: 'glass' },
        desks: {
          a: { palette: 'neon', active: 3 },
          b: 'nope',
          c: { skin: '' },
          d: { active: '#00ff00' },
        },
      }),
    ).toEqual({
      global: { ...DEFAULT_LOOK, skin: 'glass' },
      desks: { a: { palette: 'neon' }, d: { active: '#00ff00' } },
    });
    expect(LookSettingSchema.parse({})).toEqual({ global: DEFAULT_LOOK, desks: {} });
    expect(LookSettingSchema.parse({ global: 'x', desks: [] })).toEqual({
      global: DEFAULT_LOOK,
      desks: {},
    });
  });
});

describe('a look as CSS', () => {
  it('sets the palette, its accent and the ACTIVE colour', () => {
    const green = lookVars(resolveLook(setting(), null, library));
    expect(green['--p9']).toBe(PALETTES.sunset.colors[9]);
    expect(green['--accent']).toBe(PALETTES.sunset.colors[9]);
    expect(green['--active']).toBe(DEFAULT_ACTIVE);
    expect(green['--active-ink']).toBe(inkFor(DEFAULT_ACTIVE));
    const own = setting({ desks: { d: { active: '#1a1a40' } } });
    const vars = lookVars(resolveLook(own, 'd', library));
    expect(vars['--active']).toBe('#1a1a40');
    expect(vars['--active-ink']).toBe(inkFor('#1a1a40'));
    expect(cssText({ '--a': '1', '--b': 'x' })).toBe('--a: 1; --b: x');
  });
});
