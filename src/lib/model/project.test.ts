import { describe, expect, it } from 'vitest';
import type { Skin } from '../skins/schema';
import { newPreset } from './factory';
import type { CustomPalette } from './preset';
import { buildProject, parseProject, PROJECT_VERSION, ProjectError } from './project';

const palette = (id: string): CustomPalette => ({
  id,
  name: id.toUpperCase(),
  source: '#3cb4ff',
  colors: Array(10).fill('#3cb4ff'),
  overridden: Array(10).fill(false),
});
const skin = (id: string): Skin =>
  ({ format: 'oscoctopus-skin', version: 1, id, name: id, base: 'terminal' }) as Skin;

function source() {
  const a = newPreset('Stage');
  const b = newPreset('Booth');
  return {
    id: 'proj-1',
    name: '  Friday  ',
    desks: [a, b],
    activeDesk: b.id,
    look: {
      global: { palette: 'custom-a' as const, active: '#5fd787', skin: 'terminal' },
      desks: {
        [b.id]: { skin: 'skin-b' },
        'p-closed': { palette: 'custom-z' as const, skin: 'skin-z' },
      },
    },
    theme: { mode: 'light' as const, custom: [palette('custom-a'), palette('custom-z')] },
    userSkins: [skin('skin-b'), skin('skin-z')],
    now: new Date('2026-10-08T20:00:00Z'),
  };
}

describe('buildProject', () => {
  it('keeps the open desks, and only the look, palettes and skins they use', () => {
    const src = source();
    const file = buildProject(src);
    expect(file).toMatchObject({
      format: 'oscoctopus-project',
      version: PROJECT_VERSION,
      name: 'Friday',
      savedAt: '2026-10-08T20:00:00.000Z',
      activeDesk: src.activeDesk,
    });
    expect(file.desks).toHaveLength(2);
    expect(Object.keys(file.look.desks)).toEqual([src.desks[1]!.id]);
    expect(file.theme).toEqual({ mode: 'light', custom: [palette('custom-a')] });
    expect(file.skins).toEqual([skin('skin-b')]);
  });
});

describe('parseProject', () => {
  it('reads back what it saved', () => {
    const src = source();
    const project = parseProject(JSON.parse(JSON.stringify(buildProject(src))));
    expect(project.desks.map((d) => d.name)).toEqual(['Stage', 'Booth']);
    expect(project.activeDesk).toBe(src.activeDesk);
    expect(project.skins.map((s) => s.id)).toEqual(['skin-b']);
  });

  it('migrates a desk saved by an older app', () => {
    const file = buildProject(source());
    const old = { ...JSON.parse(JSON.stringify(file.desks[0])), schemaVersion: 11 };
    for (const w of old.widgets) delete w.parent;
    const project = parseProject({ ...file, desks: [old] });
    expect(project.desks[0]!.widgets.every((w) => w.parent === null)).toBe(true);
  });

  it('refuses what it could not restore', () => {
    const file = JSON.parse(JSON.stringify(buildProject(source())));
    expect(() => parseProject({ ...file, version: PROJECT_VERSION + 1 })).toThrow(/newer/);
    expect(() => parseProject({ ...file, desks: [file.desks[0], file.desks[0]] })).toThrow(
      /same desk twice/,
    );
    expect(() => parseProject({ ...file, desks: [{ id: 'x' }] })).toThrow(ProjectError);
    expect(() => parseProject({ ...file, format: 'oscoctopus-skin' })).toThrow(/not a project/);
    expect(() => parseProject({ ...file, skins: [{ id: 'nope' }] })).toThrow(/skin 1/);
  });
});
