// Workspace behaviour against a fake IPC layer: opening desks, and importing a preset file
// into an existing desk.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { newPreset } from '../model/factory';
import type { Preset } from '../model/preset';

const files = new Map<string, unknown>();
const applied: { desk: string; outputs: number }[] = [];

vi.mock('../ipc/commands', () => ({
  presets: {
    dir: async () => '/presets',
    list: async () =>
      [...files.entries()]
        .filter(([k]) => !k.startsWith('/'))
        .map(([id, p]) => ({
          id,
          name: (p as Preset).name,
          updatedAt: null,
          fileName: `${id}.json`,
          error: null,
        })),
    load: async (id: string) => structuredClone(files.get(id)),
    save: async (p: Preset) => {
      files.set(p.id, structuredClone(p));
      return {
        id: p.id,
        name: p.name,
        updatedAt: p.updatedAt,
        fileName: `${p.id}.json`,
        error: null,
      };
    },
    readFile: async (path: string) => structuredClone(files.get(path)),
    remove: async (id: string) => void files.delete(id),
    exportTo: async () => {},
  },
}));
vi.mock('./network.svelte', () => ({
  networkStore: {
    apply: async (desk: string, cfg: { outputs: unknown[] }) =>
      void applied.push({ desk, outputs: cfg.outputs.length }),
    scheduleApply: () => {},
    closeDesk: async () => {},
  },
}));
vi.mock('../platform/settings', () => ({
  getSetting: async () => undefined,
  setSetting: async () => {},
}));

const { presetStore } = await import('./preset.svelte');

describe('workspace', () => {
  beforeEach(() => {
    files.clear();
    applied.length = 0;
  });

  it('imports a file into an existing desk in place', async () => {
    await presetStore.init();
    const desk = presetStore.current;
    const deskId = desk.id;
    const created = desk.createdAt;

    // The file shares widget ids with the open desk (e.g. it's an old export of it).
    const incoming = structuredClone($state.snapshot(desk)) as Preset;
    incoming.id = 'p-other';
    incoming.name = 'Imported desk';
    incoming.widgets = incoming.widgets.slice(0, 2);
    incoming.network.outputs.push({
      ...incoming.network.outputs[0]!,
      id: 'out-extra',
      name: 'Extra',
    });
    files.set('/tmp/import.json', incoming);

    await presetStore.importInto(deskId, '/tmp/import.json');

    const after = presetStore.current;
    expect(presetStore.desks).toHaveLength(1);
    expect(after.id).toBe(deskId); // same desk, same tab
    expect(after.createdAt).toBe(created);
    expect(after.name).toBe('Imported desk');
    expect(after.widgets).toHaveLength(2);
    expect(after.network.outputs).toHaveLength(2);
    expect(applied.at(-1)).toEqual({ desk: deskId, outputs: 2 }); // network restarted
    expect((files.get(deskId) as Preset).name).toBe('Imported desk'); // saved
  });

  it('never opens the same preset twice', async () => {
    const p = newPreset('Twice');
    files.set(p.id, p);
    await presetStore.openDesk(p.id);
    await presetStore.openDesk(p.id);
    expect(presetStore.desks.filter((d) => d.id === p.id)).toHaveLength(1);
  });
});
