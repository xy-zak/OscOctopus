import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomPalette } from '../model/preset';
import { DEFAULT_ACTIVE } from '../theme/look';
import { PALETTE_SIZE, PALETTES } from '../theme/palettes';

let saved: Record<string, unknown> = {};
vi.mock('../platform/settings', () => ({
  getSetting: async (key: string) => saved[key],
  setSetting: async (key: string, value: unknown) => {
    saved[key] = JSON.parse(JSON.stringify(value));
  },
}));
vi.mock('../ipc/commands', () => ({
  skins: { list: async () => [], save: async () => {}, remove: async () => {} },
}));

const { appearance } = await import('./appearance.svelte');
const { skinStore } = await import('./skins.svelte');
const { lookStore } = await import('./look.svelte');

const mine: CustomPalette = {
  id: 'custom-abc123',
  name: 'MINE',
  source: '#3cb4ff',
  colors: [...PALETTES.cobalt.colors],
  overridden: Array<boolean>(PALETTE_SIZE).fill(false),
};
/** A user skin's id (the store doesn't check it's there: a desk may wear one from a re-import). */
const mySkin = 'skin-mine';

beforeEach(() => {
  saved = {};
  lookStore.setting = {
    global: { palette: 'rainbow', active: DEFAULT_ACTIVE, skin: 'terminal' },
    desks: {},
  };
  appearance.theme = { mode: 'dark', custom: [] };
  skinStore.user = [];
});

describe('look', () => {
  it('starts as RAINBOW, GREEN and TERMINAL everywhere, and saves that', async () => {
    await lookStore.load();
    expect(lookStore.global).toMatchObject({ paletteId: 'rainbow', active: DEFAULT_ACTIVE });
    expect(lookStore.global.skin.id).toBe('terminal');
    expect(lookStore.forDesk('p-1')).toEqual(lookStore.global);
    expect(saved.look).toEqual({
      global: { palette: 'rainbow', active: DEFAULT_ACTIVE, skin: 'terminal' },
      desks: {},
    });
  });

  it('carries over the palette of the old theme and the old skin choice, once', async () => {
    saved.theme = { palette: 'sunset', accent: 2, mode: 'dark', custom: [] };
    saved.skins = { global: 'glass', desks: { 'p-1': 'sketch', 'p-2': 42 } };
    await lookStore.load();
    expect(lookStore.setting).toEqual({
      global: { palette: 'sunset', active: DEFAULT_ACTIVE, skin: 'glass' },
      desks: { 'p-1': { skin: 'sketch' } },
    });
    // From then on the look is what loads.
    saved.theme = { palette: 'neon', accent: 2 };
    await lookStore.load();
    expect(lookStore.setting.global.palette).toBe('sunset');
  });

  it('carries over a v3 preset’s palette when there was no saved theme', async () => {
    await lookStore.load({ palette: 'neon', accent: 3 });
    expect(lookStore.setting.global.palette).toBe('neon');
  });

  it('lets a desk make each choice its own, and follow every desk again on null', async () => {
    await lookStore.choose('p-1', 'palette', 'neon');
    await lookStore.choose('p-1', 'active', '#ff0000');
    expect(lookStore.forDesk('p-1')).toMatchObject({ paletteId: 'neon', active: '#ff0000' });
    expect(lookStore.forDesk('p-1').skin.id).toBe('terminal');
    expect(lookStore.forDesk('p-2').paletteId).toBe('rainbow');
    expect(lookStore.chosen('p-1', 'skin')).toBeNull();
    expect(saved.look).toMatchObject({ desks: { 'p-1': { palette: 'neon', active: '#ff0000' } } });

    await lookStore.choose(null, 'skin', 'glass');
    expect(lookStore.forDesk('p-1').skin.id).toBe('glass');

    await lookStore.choose('p-1', 'palette', null);
    await lookStore.choose('p-1', 'active', null);
    expect(lookStore.hasOwn('p-1')).toBe(false);
    expect(saved.look).toMatchObject({ desks: {} });
  });

  it('shows a colour still being picked, and saves it once it settles', async () => {
    await lookStore.choose(null, 'active', '#3cb4ff', false);
    expect(lookStore.global.active).toBe('#3cb4ff');
    expect(saved.look).toBeUndefined();
    await lookStore.choose(null, 'active', '#3cb4ff');
    expect(saved.look).toMatchObject({ global: { active: '#3cb4ff' } });
  });

  it('shows every desk’s choice for a desk’s palette or skin that is gone', async () => {
    lookStore.setting.desks['p-1'] = { palette: 'custom-gone', skin: 'skin-gone' };
    await lookStore.choose(null, 'palette', 'amber');
    expect(lookStore.forDesk('p-1').paletteId).toBe('amber');
    expect(lookStore.forDesk('p-1').skin.id).toBe('terminal');
    expect(lookStore.chosen('p-1', 'palette')).toBeNull();
    // The choice itself is kept: it may come back (a palette on another device, a re-import).
    expect(lookStore.own('p-1')).toEqual({ palette: 'custom-gone', skin: 'skin-gone' });
  });

  it('takes a deleted palette or skin off every desk that wears it', async () => {
    appearance.theme = { ...appearance.theme, custom: [mine] };
    await lookStore.choose(null, 'palette', mine.id);
    await lookStore.choose('p-1', 'palette', mine.id);
    await lookStore.choose('p-2', 'palette', 'neon');
    await lookStore.choose('p-2', 'skin', mySkin);
    expect(lookStore.wears('palette', mine.id)).toBe(true);

    await lookStore.forget('palette', mine.id);
    expect(lookStore.setting).toEqual({
      global: { palette: 'rainbow', active: DEFAULT_ACTIVE, skin: 'terminal' },
      desks: { 'p-2': { palette: 'neon', skin: mySkin } },
    });
    await lookStore.forget('skin', mySkin);
    expect(lookStore.own('p-2')).toEqual({ palette: 'neon' });
  });

  it('forgets a deleted desk’s look, and copies a duplicated one', async () => {
    await lookStore.choose('p-1', 'skin', 'glass');
    await lookStore.copyDesk('p-1', 'p-3');
    expect(lookStore.own('p-3')).toEqual({ skin: 'glass' });
    await lookStore.forgetDesk('p-1');
    expect(Object.keys(lookStore.setting.desks)).toEqual(['p-3']);
    saved = {};
    await lookStore.forgetDesk('p-9');
    expect(saved.look).toBeUndefined();
  });

  it('never unsets the look of every desk', async () => {
    await lookStore.choose(null, 'palette', null);
    expect(lookStore.setting.global.palette).toBe('rainbow');
  });
});
