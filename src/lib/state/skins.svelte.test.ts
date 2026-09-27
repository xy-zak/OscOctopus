import { beforeEach, describe, expect, it, vi } from 'vitest';

let saved: Record<string, unknown> = {};
vi.mock('../platform/settings', () => ({
  getSetting: async (key: string) => saved[key],
  setSetting: async (key: string, value: unknown) => {
    saved[key] = value;
  },
}));

/** The skins directory, in memory: file name (without .json) → contents. */
let files: Record<string, unknown> = {};
vi.mock('../ipc/commands', () => ({
  skins: {
    list: async () =>
      Object.entries(files).map(([id, skin]) =>
        typeof skin === 'string' ? { id, skin: null, error: skin } : { id, skin, error: null },
      ),
    save: async (skin: { id: string }) => {
      files[skin.id] = JSON.parse(JSON.stringify(skin));
    },
    remove: async (id: string) => {
      delete files[id];
    },
    exportTo: async () => {},
  },
}));

const { SkinSelectionSchema, skinStore } = await import('./skins.svelte');

const mine = (id = 'skin-mine', name = 'Mine') => ({
  format: 'oscoctopus-skin',
  version: 1,
  id,
  name,
  base: 'glass',
  parts: { 'switch.thumb': { rest: { radius: 3 } } },
});

beforeEach(() => {
  saved = {};
  files = {};
  skinStore.selection = { global: 'terminal', desks: {} };
  skinStore.user = [];
  skinStore.problems = [];
});

describe('skin selection', () => {
  it('starts as TERMINAL everywhere', async () => {
    await skinStore.load();
    expect(skinStore.global.id).toBe('terminal');
    expect(skinStore.forDesk('p-1').id).toBe('terminal');
    expect(skinStore.overrideOf('p-1')).toBeNull();
  });

  it('shows TERMINAL for a skin that no longer exists', async () => {
    saved.skins = { global: 'skin-gone', desks: { 'p-1': 'skin-gone-too' } };
    await skinStore.load();
    expect(skinStore.global.id).toBe('terminal');
    expect(skinStore.forDesk('p-1').id).toBe('terminal');
    // The choice itself is kept: the skin may come back (e.g. re-imported).
    expect(skinStore.overrideOf('p-1')).toBe('skin-gone-too');
  });

  it('gives a desk its own skin, saved, and follows the global one again on null', async () => {
    await skinStore.setDesk('p-1', 'glass');
    expect(saved.skins).toEqual({ global: 'terminal', desks: { 'p-1': 'glass' } });
    expect(skinStore.forDesk('p-1').id).toBe('glass');
    await skinStore.setDesk('p-1', null);
    expect(skinStore.overrideOf('p-1')).toBeNull();
    expect(saved.skins).toEqual({ global: 'terminal', desks: {} });
  });

  it('forgets a deleted desk’s choice, and only writes when there was one', async () => {
    await skinStore.setDesk('p-1', 'glass');
    await skinStore.setDesk('p-2', 'sketch');
    await skinStore.forgetDesk('p-1');
    expect(saved.skins).toEqual({ global: 'terminal', desks: { 'p-2': 'sketch' } });
    saved = {};
    await skinStore.forgetDesk('p-9');
    expect(saved.skins).toBeUndefined();
  });

  it('keeps what is valid when part of the saved setting is not', () => {
    expect(SkinSelectionSchema.parse({ global: 42, desks: { a: 'terminal' } })).toEqual({
      global: 'terminal',
      desks: { a: 'terminal' },
    });
    expect(SkinSelectionSchema.parse({ global: 'terminal', desks: 'nope' })).toEqual({
      global: 'terminal',
      desks: {},
    });
    expect(SkinSelectionSchema.parse({})).toEqual({ global: 'terminal', desks: {} });
  });
});

describe('user skins', () => {
  it('loads the valid ones and lists the rest as problems', async () => {
    files = {
      'skin-mine': mine(),
      'skin-bad': { ...mine('skin-bad'), base: 'no-such-skin' },
      'skin-broken': 'expected value at line 1',
    };
    await skinStore.load();
    expect(skinStore.user.map((s) => s.id)).toEqual(['skin-mine']);
    expect(skinStore.problems.map((p) => p.id).sort()).toEqual(['skin-bad', 'skin-broken']);
    // Listed after the built-in ones, drawn by its base skin.
    const info = skinStore.available.at(-1)!;
    expect(info).toMatchObject({ id: 'skin-mine', name: 'MINE', base: 'glass', user: true });
    expect(info.params.keycap).toBe('flat');
  });

  it('can be picked, and a desk wearing a deleted one goes back to the global skin', async () => {
    files = { 'skin-mine': mine() };
    await skinStore.load();
    await skinStore.setGlobal('skin-mine');
    await skinStore.setDesk('p-1', 'skin-mine');
    expect(skinStore.forDesk('p-1').id).toBe('skin-mine');
    await skinStore.deleteUser('skin-mine');
    expect(files).toEqual({});
    expect(skinStore.selection).toEqual({ global: 'terminal', desks: {} });
    expect(saved.skins).toEqual({ global: 'terminal', desks: {} });
  });

  it('imports a skin file, as a copy with a new id if the id is taken', async () => {
    const first = await skinStore.importText(JSON.stringify(mine()));
    expect(first.id).toBe('skin-mine');
    const second = await skinStore.importText(JSON.stringify(mine('skin-mine', 'Again')));
    expect(second.id).not.toBe('skin-mine');
    expect(second.id).toMatch(/^skin-[a-z0-9]+$/);
    expect(Object.keys(files).sort()).toEqual([second.id, 'skin-mine'].sort());
    expect(skinStore.user.map((s) => s.name)).toEqual(['Again', 'Mine']);
  });

  it('refuses a file that isn’t a valid skin, saying why', async () => {
    await expect(skinStore.importText('{ nope')).rejects.toThrow(/not a skin file/);
    await expect(
      skinStore.importText(
        JSON.stringify({ ...mine(), parts: { 'pads.num': { rest: { opacity: 0.5 } } } }),
      ),
    ).rejects.toThrow(/marker/);
    expect(files).toEqual({});
  });
});
