import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const { skinStore } = await import('./skins.svelte');

const mine = (id = 'skin-mine', name = 'Mine') => ({
  format: 'oscoctopus-skin',
  version: 1,
  id,
  name,
  base: 'glass',
  parts: { 'switch.thumb': { rest: { radius: 3 } } },
});

beforeEach(() => {
  files = {};
  skinStore.user = [];
  skinStore.problems = [];
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

  it('are deleted with their file', async () => {
    files = { 'skin-mine': mine() };
    await skinStore.load();
    await skinStore.deleteUser('skin-mine');
    expect(files).toEqual({});
    expect(skinStore.user).toEqual([]);
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
