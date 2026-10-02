// Workspace behaviour against a fake IPC layer: opening desks, and importing a preset file
// into an existing desk.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { newPreset } from '../model/factory';
import type { Preset, SubdeskWidget, Widget } from '../model/preset';
import { resolvePage } from '../model/subdesks';
import { newWidget } from '../widgets/defs';

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
const { ui } = await import('./ui.svelte');
const { values } = await import('./values.svelte');

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

  it('counts and strips a sequence’s output like a message’s', async () => {
    await presetStore.init();
    const out = presetStore.current.network.outputs[0]!;
    const before = presetStore.outputUsage(out.id);
    presetStore.addWidget('sequencer');
    const seq = presetStore.current.widgets.at(-1)!;
    expect(seq.type === 'sequencer' && seq.props.outputIds).toEqual([out.id]);
    expect(presetStore.outputUsage(out.id)).toBe(before + 1);
    presetStore.removeOutput(out.id);
    expect(seq.type === 'sequencer' && seq.props.outputIds).toEqual([]);
    expect(presetStore.outputUsage(out.id)).toBe(0);
  });

  it('never opens the same preset twice', async () => {
    const p = newPreset('Twice');
    files.set(p.id, p);
    await presetStore.openDesk(p.id);
    await presetStore.openDesk(p.id);
    expect(presetStore.desks.filter((d) => d.id === p.id)).toHaveLength(1);
  });
});

describe('sub-desks', () => {
  /** A fresh desk in EDIT with a sub-desk on it, its page open. */
  async function deskWithSubdesk() {
    await presetStore.init();
    await presetStore.newDesk('Subs');
    ui.mode = 'edit';
    ui.page = null;
    presetStore.addWidget('subdesk');
    const sub = presetStore.current.widgets.at(-1) as SubdeskWidget;
    presetStore.openSubdesk(sub.id);
    const page = { widget: sub.id, page: sub.props.pages[0]!.id };
    return { desk: presetStore.current, sub, page };
  }
  const last = (): Widget => presetStore.current.widgets.at(-1)!;
  const deletedBy = async (run: () => void) => {
    const { deskChanges } = await import('./changes');
    const deleted: string[] = [];
    const stop = deskChanges.on((c) => deleted.push(...(c.deleted ?? [])));
    run();
    stop();
    return deleted;
  };

  it('adds widgets to the open page, in its own grid', async () => {
    const { desk, page } = await deskWithSubdesk();
    expect(presetStore.page).toEqual(page);
    presetStore.addWidget('button');
    const button = last();
    expect(button.parent).toEqual(page);
    // The desk's widgets fill (0,0) on the desk, not on the page.
    expect(button).toMatchObject({ x: 0, y: 0 });
    expect(desk.widgets.some((w) => !w.parent && w.x === 0 && w.y === 0)).toBe(true);
    expect(presetStore.pageOf(button.id)).toEqual(page);
    // Leaving EDIT closes the page.
    ui.mode = 'live';
    expect(presetStore.page).toBeNull();
  });

  it('resizes the open page’s grid, never under its widgets', async () => {
    const { sub, desk } = await deskWithSubdesk();
    presetStore.addWidget('button');
    last().x = 4;
    expect(presetStore.setGrid({ cols: 5 })).toBe(false);
    expect(presetStore.setGrid({ cols: 8, rows: 2 })).toBe(true);
    expect(sub.props.pages[0]!.grid).toMatchObject({ cols: 8, rows: 2 });
    expect(desk.grid.cols).toBe(12);
  });

  it('removes a sub-desk with everything on it, naming every deletion', async () => {
    const { sub } = await deskWithSubdesk();
    presetStore.addWidget('subdesk');
    const inner = last() as SubdeskWidget;
    presetStore.openSubdesk(inner.id);
    presetStore.addWidget('slider');
    const fader = last();
    ui.selectedId = fader.id;
    const deleted = await deletedBy(() => presetStore.removeWidget(sub.id));
    expect(deleted.sort()).toEqual([`w/${sub.id}`, `w/${inner.id}`, `w/${fader.id}`].sort());
    expect(presetStore.current.widgets.some((w) => w.parent)).toBe(false);
    expect(values[fader.id]).toBeUndefined();
    expect(ui.page).toBeNull();
    expect(ui.selectedId).toBeNull();
  });

  it('duplicates a sub-desk with its pages; references outside it stay', async () => {
    const { sub, desk } = await deskWithSubdesk();
    const outsider = desk.widgets.find((w) => !w.parent && w.type === 'slider')!;
    presetStore.addWidget('slider');
    const fader = last();
    presetStore.addWidget('text');
    const monitor = last();
    if (monitor.type === 'text') monitor.props = { ...monitor.props, target: outsider.id };
    presetStore.addWidget('log');
    const log = last();
    if (log.type === 'log') log.props = { ...log.props, follow: 'chosen', sources: [fader.id] };
    presetStore.openPage(null);
    desk.grid = { ...desk.grid, rows: 16 }; // room for a copy of the same size
    presetStore.duplicateWidget(sub.id);
    const copy = desk.widgets.find((w) => w.id === ui.selectedId) as SubdeskWidget;
    expect(copy.id).not.toBe(sub.id);
    expect(copy.parent).toBeNull();
    const onCopy = desk.widgets.filter((w) => w.parent?.widget === copy.id);
    expect(onCopy.map((w) => w.type).sort()).toEqual(['log', 'slider', 'text']);
    const cFader = onCopy.find((w) => w.type === 'slider')!;
    const cMonitor = onCopy.find((w) => w.type === 'text');
    const cLog = onCopy.find((w) => w.type === 'log');
    expect(cMonitor?.type === 'text' && cMonitor.props.target).toBe(outsider.id);
    expect(cLog?.type === 'log' && cLog.props.sources).toEqual([cFader.id]);
    for (const w of [copy, ...onCopy]) expect(values[w.id]).toBeDefined();
  });

  it('puts a widget on another page, but never into itself', async () => {
    const { sub, page } = await deskWithSubdesk();
    presetStore.openPage(null);
    const button = presetStore.current.widgets.find((w) => w.type === 'button')!;
    expect(presetStore.place(button.id, page)).toBe(true);
    expect(button.parent).toEqual(page);
    expect(ui.page).toEqual(page);
    expect(presetStore.place(sub.id, page)).toBe(false);
    expect(sub.parent).toBeNull();
    expect(presetStore.place(button.id, null)).toBe(true);
    expect(button.parent).toBeNull();
    // Too big for the page's 6×4 grid: it goes there smaller.
    Object.assign(button, { w: 8, h: 6 });
    expect(presetStore.place(button.id, page)).toBe(true);
    expect(button).toMatchObject({ parent: page, w: 6, h: 4 });
  });

  it('adds, orders and removes pages; showing one is never sent or shared', async () => {
    const { sub } = await deskWithSubdesk();
    const { localValues } = await import('./changes');
    const emitted: unknown[] = [];
    const stop = localValues.on((v) => emitted.push(v));
    expect(presetStore.addBlankPage(sub.id)).toBe(true);
    const [first, second] = sub.props.pages;
    expect(values[sub.id]).toBe(second!.id);
    presetStore.showPage(sub.id, first!.id);
    expect(values[sub.id]).toBe(first!.id);
    stop();
    expect(emitted).toEqual([]);

    presetStore.movePage(sub.id, second!.id, -1);
    expect(sub.props.pages.map((p) => p.id)).toEqual([second!.id, first!.id]);
    presetStore.openPage({ widget: sub.id, page: first!.id });
    presetStore.addWidget('button');
    const button = last();
    const deleted = await deletedBy(() => presetStore.removePage(sub.id, first!.id));
    expect(deleted).toEqual([`w/${button.id}`]);
    expect(sub.props.pages.map((p) => p.id)).toEqual([second!.id]);
    expect(values[sub.id]).toBe(second!.id);
    expect(presetStore.page).toBeNull();
    // The last page stays.
    presetStore.removePage(sub.id, second!.id);
    expect(sub.props.pages).toHaveLength(1);
  });

  it('refuses a sub-desk deeper than they nest', async () => {
    await deskWithSubdesk();
    for (let i = 0; i < 2; i++) {
      presetStore.addWidget('subdesk');
      presetStore.openSubdesk(last().id);
    }
    const count = presetStore.current.widgets.length;
    presetStore.addWidget('subdesk');
    expect(presetStore.current.widgets).toHaveLength(count);
    presetStore.addWidget('button');
    expect(presetStore.current.widgets).toHaveLength(count + 1);
  });

  it('keeps the nesting when a desk is opened with fresh widget ids', async () => {
    await presetStore.init();
    const p = newPreset('Nested');
    const sub = newWidget('subdesk', { x: 0, y: 6, w: 4, h: 2 }, []);
    const page = { widget: sub.id, page: sub.props.pages[0]!.id };
    p.widgets.push(sub, newWidget('button', { x: 0, y: 0, w: 1, h: 1 }, [], 1, page));
    files.set(p.id, structuredClone(p));
    // The same widgets again, under another preset id: their ids clash.
    const twin = { ...structuredClone(p), id: 'p-twin', name: 'Twin' };
    files.set(twin.id, twin);
    await presetStore.openDesk(p.id);
    await presetStore.openDesk(twin.id);
    const opened = presetStore.current;
    const openedSub = opened.widgets.find((w) => w.type === 'subdesk')!;
    expect(openedSub.id).not.toBe(sub.id);
    const child = opened.widgets.find((w) => w.parent)!;
    expect(resolvePage(opened, child.parent)).toEqual(child.parent);
    expect(child.parent?.widget).toBe(openedSub.id);
  });

  it('copies a saved desk in as a sub-desk, a page, and again over its page', async () => {
    await deskWithSubdesk();
    const desk = presetStore.current;
    const network = JSON.stringify($state.snapshot(desk.network));
    const small = newPreset('Small desk', { loopbackInput: false });
    small.widgets = small.widgets.slice(0, 2);
    small.grid = { cols: 4, rows: 3, gap: 2 };
    files.set(small.id, structuredClone(small));
    presetStore.openPage(null);

    // Asked first; saying no changes nothing.
    const count = desk.widgets.length;
    expect(await presetStore.embed(small.id, { kind: 'new' }, async () => false)).toBe(false);
    expect(desk.widgets).toHaveLength(count);

    // A new sub-desk, named after it, its page copied from it.
    let asked = 0;
    const yes = async (plan: { widgets: unknown[] }) => ((asked = plan.widgets.length), true);
    expect(await presetStore.embed(small.id, { kind: 'new' }, yes)).toBe(true);
    expect(asked).toBe(2);
    const sub = desk.widgets.find((w) => w.id === ui.selectedId) as SubdeskWidget;
    expect(sub).toMatchObject({ type: 'subdesk', label: 'Small desk', parent: null });
    const [page] = sub.props.pages;
    expect(page).toMatchObject({ name: 'Small desk', source: small.id, grid: small.grid });
    const onPage = desk.widgets.filter((w) => w.parent?.page === page!.id);
    expect(onPage).toHaveLength(2);
    expect(onPage.every((w) => values[w.id] !== undefined)).toBe(true);
    // Its messages send through this desk's own output; NETWORK is as it was.
    const out = desk.network.outputs[0]!.id;
    expect(onPage.every((w) => w.bindings.every((b) => b.outputIds.join() === out))).toBe(true);
    expect(JSON.stringify($state.snapshot(desk.network))).toBe(network);

    // Another page of the same sub-desk, shown.
    await presetStore.embed(small.id, { kind: 'page', widget: sub.id });
    expect(sub.props.pages).toHaveLength(2);
    expect(values[sub.id]).toBe(sub.props.pages[1]!.id);

    // The saved desk changes; copying it again replaces what is on the page.
    const changed = { ...structuredClone(small), updatedAt: '2030-01-01T00:00:00.000Z' };
    changed.widgets = changed.widgets.slice(0, 1);
    changed.grid = { cols: 2, rows: 2, gap: 2 };
    files.set(small.id, changed);
    const old = onPage.map((w) => w.id);
    const { deskChanges } = await import('./changes');
    const deleted: string[] = [];
    const stop = deskChanges.on((c) => deleted.push(...(c.deleted ?? [])));
    await presetStore.embed(small.id, { kind: 'update', widget: sub.id, page: page!.id });
    stop();
    expect(deleted.sort()).toEqual(old.map((id) => `w/${id}`).sort());
    const now = desk.widgets.filter((w) => w.parent?.page === page!.id);
    expect(now).toHaveLength(1);
    expect(old).not.toContain(now[0]!.id);
    expect(sub.props.pages[0]).toMatchObject({
      id: page!.id,
      copiedAt: '2030-01-01T00:00:00.000Z',
      grid: { cols: 2, rows: 2, gap: 2 },
    });
  });

  it('sends everything on a page to one output', async () => {
    const { sub, desk, page } = await deskWithSubdesk();
    desk.network.outputs.push({ ...desk.network.outputs[0]!, id: 'out-2', name: 'Two' });
    presetStore.addWidget('slider');
    const fader = last();
    expect(fader.bindings[0]!.outputIds).not.toEqual(['out-2']);
    presetStore.routePage(sub.id, page.page, 'out-2');
    expect(fader.bindings[0]!.outputIds).toEqual(['out-2']);
    presetStore.routePage(sub.id, page.page, 'out-gone');
    expect(fader.bindings[0]!.outputIds).toEqual(['out-2']);
  });
});
