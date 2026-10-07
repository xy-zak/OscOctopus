// Loading a project against fake stores: what it says it will do, and that a shared desk comes
// back as an unshared copy (never overwritten for the session) with its look and the shown desk
// following the copy.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { newPreset } from '../model/factory';
import type { Preset } from '../model/preset';
import { buildProject } from '../model/project';

const saved = new Map<string, unknown>();
const shared = new Set<string>();
const restored: { desks: Preset[]; active: string | null }[] = [];
const looks: { renamed: Map<string, string> }[] = [];
const palettes: string[] = [];
const open: Preset[] = [];

vi.mock('../ipc/commands', () => ({
  projects: {
    list: async () => [],
    load: async (id: string) => structuredClone(saved.get(id)),
    save: async () => {},
  },
  sync: { docLoad: async (id: string) => (shared.has(id) ? { deskId: id } : null) },
}));
vi.mock('./preset.svelte', () => ({
  presetStore: {
    get desks() {
      return open;
    },
    get summaries() {
      return [...saved.keys()].filter((k) => k.startsWith('p-')).map((id) => ({ id, error: null }));
    },
    restoreWorkspace: async (desks: Preset[], active: string | null) =>
      void restored.push({ desks, active }),
  },
}));
vi.mock('./look.svelte', () => ({
  lookStore: {
    restore: async (_look: unknown, _desks: unknown, renamed: Map<string, string>) =>
      void looks.push({ renamed }),
  },
}));
vi.mock('./appearance.svelte', () => ({
  appearance: {
    saveCustom: async (p: { id: string }) => (palettes.push(p.id), p.id !== 'custom-full'),
    set: async () => {},
  },
}));
vi.mock('./skins.svelte', () => ({ skinStore: { saveUser: async () => {} } }));

const { projectStore } = await import('./projects.svelte');

const palette = (id: string) => ({
  id,
  name: id.toUpperCase(),
  source: '#3cb4ff',
  colors: Array(10).fill('#3cb4ff'),
  overridden: Array(10).fill(false),
});

beforeEach(() => {
  saved.clear();
  shared.clear();
  restored.length = looks.length = palettes.length = open.length = 0;
});

function project() {
  const mine = newPreset('Mine');
  const theirs = newPreset('Shared one');
  const file = buildProject({
    id: 'proj-1',
    name: 'Show',
    desks: [mine, theirs],
    activeDesk: theirs.id,
    look: {
      global: { palette: 'custom-full', active: '#5fd787', skin: 'terminal' },
      desks: { [theirs.id]: { palette: 'custom-ok' } },
    },
    theme: { mode: 'dark', custom: [palette('custom-full'), palette('custom-ok')] },
    userSkins: [],
  });
  saved.set('proj-1', file);
  return { mine, theirs };
}

describe('loading a project', () => {
  it('says which desks it resets, copies and closes', async () => {
    const { mine, theirs } = project();
    saved.set(mine.id, mine);
    shared.add(theirs.id);
    open.push(newPreset('Open now'));
    const plan = await projectStore.plan('proj-1');
    expect(plan).toMatchObject({ reset: ['Mine'], copied: ['Shared one'], closing: ['Open now'] });
  });

  it('opens a shared desk as a copy, and reports palettes with no room', async () => {
    const { mine, theirs } = project();
    shared.add(theirs.id);
    const plan = await projectStore.plan('proj-1');
    const noRoom = await projectStore.restore(plan.project);

    expect(noRoom).toEqual(['CUSTOM-FULL']);
    expect(palettes).toEqual(['custom-full', 'custom-ok']);
    const [{ desks, active }] = restored as [(typeof restored)[0]];
    expect(desks[0]!.id).toBe(mine.id);
    const copy = desks[1]!;
    expect(copy.id).not.toBe(theirs.id);
    expect(copy.name).toBe('Shared one');
    expect(copy.widgets.map((w) => w.id)).not.toEqual(theirs.widgets.map((w) => w.id));
    expect(active).toBe(copy.id);
    expect(looks[0]!.renamed.get(theirs.id)).toBe(copy.id);
  });
});
