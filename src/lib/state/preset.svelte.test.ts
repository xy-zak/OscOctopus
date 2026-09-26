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

  it('closing a desk right after an edit still saves the edit', async () => {
    await presetStore.init();
    await presetStore.newDesk('Second');
    const id = presetStore.current.id;
    presetStore.current.name = 'Renamed';
    presetStore.touch(); // autosave is still waiting out its debounce
    expect(await presetStore.closeDesk(id)).toBe(true);
    expect((files.get(id) as Preset).name).toBe('Renamed');
  });

  it('flushAll writes pending edits before the app goes away', async () => {
    await presetStore.init();
    const id = presetStore.current.id;
    presetStore.current.name = 'Edited just before quitting';
    presetStore.touch();
    expect(presetStore.isDirty(id)).toBe(true);
    await presetStore.flushAll();
    expect((files.get(id) as Preset).name).toBe('Edited just before quitting');
    expect(presetStore.isDirty(id)).toBe(false);
  });

  it('removing endpoints and widgets strips references and names what was deleted', async () => {
    await presetStore.init();
    const desk = presetStore.current;
    const { deskChanges } = await import('./changes');
    const deleted: string[] = [];
    const stop = deskChanges.on((c) => deleted.push(...(c.deleted ?? [])));
    const input = desk.network.inputs[0]!;
    const w = desk.widgets[0]!;
    w.bindings[0]!.receive = true;
    w.bindings[0]!.sourceIds = [input.id];

    presetStore.removeInput(input.id);
    expect(w.bindings[0]!.sourceIds).toEqual([]);
    presetStore.removeWidget(w.id);
    stop();
    expect(deleted).toEqual([`i/${input.id}`, `w/${w.id}`]);
  });

  it('never opens the same preset twice', async () => {
    const p = newPreset('Twice');
    files.set(p.id, p);
    await presetStore.openDesk(p.id);
    await presetStore.openDesk(p.id);
    expect(presetStore.desks.filter((d) => d.id === p.id)).toHaveLength(1);
  });
});
