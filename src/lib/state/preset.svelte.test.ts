// Workspace behaviour against a fake IPC layer: opening desks, and importing a preset file
// into an existing desk.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { newPreset } from '../model/factory';
import { findFreeSpot, type Rect } from '../grid/engine';
import type { Preset, TabRef, TabsWidget, Widget } from '../model/preset';
import { tabAt, widgetsOn } from '../model/tabs';
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

  it('opens another desk’s CONTROLS LIVE, ending an edit', async () => {
    await presetStore.init();
    const first = presetStore.current.id;
    await presetStore.newDesk('Second');
    const second = presetStore.current.id;
    Object.assign(ui, { view: 'desk', deskView: 'controls', mode: 'edit', selected: ['w1'] });
    presetStore.activate(first);
    expect(ui).toMatchObject({ mode: 'live', selected: [] });
    await presetStore.closeDesk(second);
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
    presetStore.removeWidgets([w.id]);
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

describe('frames', () => {
  /** A fresh desk in EDIT, with room to spare, and a frame on it, selected. */
  async function deskWithFrame() {
    await presetStore.init();
    await presetStore.newDesk('Frames');
    ui.mode = 'edit';
    presetStore.current.grid = { ...presetStore.current.grid, rows: 16 };
    presetStore.addWidget('tabs');
    const frame = last() as TabsWidget;
    const tab = { widget: frame.id, tab: frame.props.tabs[0]!.id };
    return { desk: presetStore.current, frame, tab };
  }
  const last = (): Widget => presetStore.current.widgets.at(-1)!;
  const move = (id: string, rect: Rect, at: TabRef | null) =>
    presetStore.moveWidgets([{ id, ...rect }], at);
  const changesBy = async (run: () => void) => {
    const { deskChanges } = await import('./changes');
    const deleted: string[] = [];
    let count = 0;
    const stop = deskChanges.on((c) => {
      count++;
      deleted.push(...(c.deleted ?? []));
    });
    run();
    stop();
    return { count, deleted };
  };

  it('adds widgets on the tab the selected frame shows, or beside the selected widget', async () => {
    const { frame, tab } = await deskWithFrame();
    expect(frame.parent).toBeNull();
    expect(presetStore.addingTo).toEqual(tab);
    presetStore.addWidget('button');
    const button = last();
    expect(button.parent).toEqual(tab);
    // In the frame's own grid: (0,0) there, though the desk's widgets fill (0,0) on the desk.
    expect(button).toMatchObject({ x: 0, y: 0 });
    expect(presetStore.tabOf(button.id)).toEqual(tab);
    // The button is selected now: the next one goes beside it, on the same tab.
    presetStore.addWidget('slider');
    expect(last().parent).toEqual(tab);
    // A frame always goes on the desk.
    presetStore.addWidget('tabs');
    expect(last().parent).toBeNull();
    presetStore.select(null);
    expect(presetStore.addingTo).toBeNull();
  });

  it('adds a widget where it was dropped, if it may go there and the cells are free', async () => {
    const { desk, frame, tab } = await deskWithFrame();
    presetStore.addWidget('button', { rect: { x: 1, y: 1, w: 2, h: 2 }, at: tab });
    const button = last();
    expect(button).toMatchObject({ type: 'button', x: 1, y: 1, w: 2, h: 2, parent: tab });
    expect(ui.selected).toEqual([button.id]);
    const count = desk.widgets.length;
    // Onto it again, or a frame into a frame: nothing is added.
    presetStore.addWidget('slider', { rect: { x: 2, y: 2, w: 1, h: 1 }, at: tab });
    presetStore.addWidget('tabs', { rect: { x: 4, y: 0, w: 1, h: 1 }, at: tab });
    expect(desk.widgets).toHaveLength(count);
    // On the desk, past every widget there.
    presetStore.addWidget('switch', { rect: { x: 0, y: 12, w: 2, h: 1 }, at: null });
    expect(last()).toMatchObject({ type: 'switch', y: 12, parent: null });
    expect(frame.parent).toBeNull();
  });

  it('moves widgets in, out and between frames, never a frame onto a tab', async () => {
    const { desk, frame, tab } = await deskWithFrame();
    const button = desk.widgets.find((w) => w.type === 'button' && !w.parent)!;
    const cell = { x: 1, y: 1, w: 1, h: 1 };
    expect(move(button.id, cell, tab)).toBe(true);
    expect(button).toMatchObject({ ...cell, parent: tab });
    // Out onto the desk where it is free; never onto taken cells, nor off the frame's grid.
    const spot = findFreeSpot({ w: 1, h: 1 }, desk.grid, widgetsOn(desk, null))!;
    expect(move(button.id, spot, null)).toBe(true);
    expect(button.parent).toBeNull();
    const taken = { x: frame.x, y: frame.y, w: 1, h: 1 };
    expect(move(button.id, taken, null)).toBe(false);
    expect(move(button.id, { x: 5, y: 0, w: 2, h: 1 }, tab)).toBe(false);
    // Onto another frame's tab.
    presetStore.addWidget('tabs');
    const other = last() as TabsWidget;
    const there = { widget: other.id, tab: other.props.tabs[0]!.id };
    expect(move(button.id, cell, there)).toBe(true);
    expect(presetStore.tabOf(button.id)).toEqual(there);
    // A frame never goes on a tab, nor on a tab that is gone.
    expect(move(other.id, cell, tab)).toBe(false);
    expect(other.parent).toBeNull();
    expect(move(button.id, cell, { widget: other.id, tab: 'tb-gone' })).toBe(false);
    // Put down where it is: nothing changes, nothing is sent.
    const same = await changesBy(() => move(button.id, cell, there));
    expect(same.count).toBe(0);
  });

  it('resizes a frame’s grid, one for all its tabs, never under what is on them', async () => {
    const { desk, frame } = await deskWithFrame();
    presetStore.addTab(frame.id);
    presetStore.addWidget('button');
    const button = last();
    expect(button.parent?.tab).toBe(frame.props.tabs[1]!.id);
    button.x = 4;
    expect(presetStore.setGrid({ cols: 5 }, frame.id)).toBe(false);
    expect(presetStore.setGrid({ cols: 8, rows: 2 }, frame.id)).toBe(true);
    expect(frame.props.grid).toMatchObject({ cols: 8, rows: 2 });
    expect(desk.grid.cols).toBe(12);
    // The desk's grid counts what is on the desk only.
    expect(presetStore.setGrid({ cols: 13 })).toBe(true);
    expect(presetStore.setGrid({ cols: 2 }, button.id)).toBe(false);
  });

  it('removes a frame with everything on its tabs, naming every deletion', async () => {
    const { frame } = await deskWithFrame();
    presetStore.addWidget('slider');
    const fader = last();
    presetStore.addTab(frame.id);
    presetStore.select(frame.id);
    presetStore.addWidget('button');
    const button = last();
    presetStore.select(fader.id);
    const { deleted } = await changesBy(() => presetStore.removeWidgets([frame.id]));
    expect(deleted.sort()).toEqual([`w/${frame.id}`, `w/${fader.id}`, `w/${button.id}`].sort());
    expect(presetStore.current.widgets.some((w) => w.parent)).toBe(false);
    expect(values[fader.id]).toBeUndefined();
    expect(ui.selected).toEqual([]);
  });

  it('duplicates a frame with its tabs; references outside it stay', async () => {
    const { frame, desk } = await deskWithFrame();
    const outsider = desk.widgets.find((w) => !w.parent && w.type === 'slider')!;
    presetStore.addWidget('slider');
    const fader = last();
    presetStore.addWidget('text');
    const monitor = last();
    if (monitor.type === 'text') monitor.props = { ...monitor.props, target: outsider.id };
    presetStore.addWidget('log');
    const log = last();
    if (log.type === 'log') log.props = { ...log.props, follow: 'chosen', sources: [fader.id] };
    presetStore.duplicateWidget(frame.id);
    const copy = presetStore.selection[0] as TabsWidget;
    expect(copy.id).not.toBe(frame.id);
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

  it('adds, orders and removes tabs; showing one is never sent or shared', async () => {
    const { frame } = await deskWithFrame();
    const { localValues } = await import('./changes');
    const emitted: unknown[] = [];
    const stop = localValues.on((v) => emitted.push(v));
    expect(presetStore.addTab(frame.id)).toBe(true);
    const [first, second] = frame.props.tabs;
    expect(second!.name).toBe('Tab 2');
    expect(values[frame.id]).toBe(second!.id);
    presetStore.showTab(frame.id, first!.id);
    expect(values[frame.id]).toBe(first!.id);
    stop();
    expect(emitted).toEqual([]);

    presetStore.moveTab(frame.id, second!.id, -1);
    expect(frame.props.tabs.map((t) => t.id)).toEqual([second!.id, first!.id]);
    presetStore.addWidget('button');
    const button = last();
    expect(button.parent?.tab).toBe(first!.id);
    const { deleted } = await changesBy(() => presetStore.removeTab(frame.id, first!.id));
    expect(deleted).toEqual([`w/${button.id}`]);
    expect(frame.props.tabs.map((t) => t.id)).toEqual([second!.id]);
    expect(values[frame.id]).toBe(second!.id);
    // The last tab stays.
    presetStore.removeTab(frame.id, second!.id);
    expect(frame.props.tabs).toHaveLength(1);
  });

  it('keeps widgets on their tabs when a desk is opened with fresh widget ids', async () => {
    await presetStore.init();
    const p = newPreset('Framed');
    const frame = newWidget('tabs', { x: 0, y: 6, w: 4, h: 2 }, []);
    const tab = { widget: frame.id, tab: frame.props.tabs[0]!.id };
    p.widgets.push(frame, newWidget('button', { x: 0, y: 0, w: 1, h: 1 }, [], 1, tab));
    files.set(p.id, structuredClone(p));
    // The same widgets again, under another preset id: their ids clash.
    const twin = { ...structuredClone(p), id: 'p-twin', name: 'Twin' };
    files.set(twin.id, twin);
    await presetStore.openDesk(p.id);
    await presetStore.openDesk(twin.id);
    const opened = presetStore.current;
    const openedFrame = opened.widgets.find((w) => w.type === 'tabs')!;
    expect(openedFrame.id).not.toBe(frame.id);
    const child = opened.widgets.find((w) => w.parent)!;
    expect(child.parent?.widget).toBe(openedFrame.id);
    expect(tabAt(opened, child.parent!)).toBeDefined();
  });

  it('forgets a frame deleted on another device, with what was on it', async () => {
    const { desk, frame } = await deskWithFrame();
    presetStore.addWidget('button');
    const button = last();
    const next = structuredClone($state.snapshot(desk)) as Preset;
    next.widgets = next.widgets.filter((w) => w.id !== frame.id && w.id !== button.id);
    presetStore.applyRemote(desk.id, next, false);
    expect(desk.widgets.some((w) => w.id === frame.id || w.id === button.id)).toBe(false);
    expect(values[button.id]).toBeUndefined();
    expect(ui.selected).toEqual([]);
  });
});

describe('selecting several widgets', () => {
  async function freshDesk() {
    await presetStore.init();
    await presetStore.newDesk('Several');
    ui.mode = 'edit';
    return presetStore.current;
  }

  it('adds and takes out with Shift, and keeps to one grid', async () => {
    const desk = await freshDesk();
    const [a, b, c] = desk.widgets;
    presetStore.select(a!.id);
    presetStore.select(b!.id, true);
    presetStore.select(c!.id, true);
    expect(ui.selected).toEqual([a!.id, b!.id, c!.id]);
    presetStore.select(b!.id, true);
    expect(presetStore.selection.map((w) => w.id)).toEqual([a!.id, c!.id]);
    presetStore.select(b!.id);
    expect(ui.selected).toEqual([b!.id]);
    // A widget on a frame's tab starts a selection of its own.
    presetStore.addWidget('tabs');
    presetStore.addWidget('button');
    const onTab = desk.widgets.at(-1)!;
    presetStore.select(a!.id);
    presetStore.select(onTab.id, true);
    expect(ui.selected).toEqual([onTab.id]);
    // Several selected: ADD puts the next one beside them.
    presetStore.addWidget('slider');
    presetStore.select(onTab.id, true);
    expect(ui.selected).toEqual([desk.widgets.at(-1)!.id, onTab.id]);
    expect(presetStore.addingTo).toEqual(onTab.parent);
  });

  it('moves them all, or none', async () => {
    const desk = await freshDesk();
    desk.grid = { ...desk.grid, rows: 16 };
    const [a, b] = desk.widgets;
    const moved = [a!, b!].map(({ id, x, y, w, h }) => ({ id, x, y: y + 8, w, h }));
    expect(presetStore.moveWidgets(moved, null)).toBe(true);
    expect([a!.y, b!.y]).toEqual(moved.map((r) => r.y));
    // One of them on a widget that stays: none moves.
    const c = desk.widgets[2]!;
    const onC = [
      { ...moved[0]!, x: c.x, y: c.y },
      { ...moved[1]!, y: 0 },
    ];
    expect(presetStore.moveWidgets(onC, null)).toBe(false);
    expect([a!.y, b!.y]).toEqual(moved.map((r) => r.y));
    // Nor onto each other.
    const stacked = [moved[0]!, { ...moved[0]!, id: b!.id }];
    expect(presetStore.moveWidgets(stacked, null)).toBe(false);
  });

  it('removes them all, with what is on their frames, naming every deletion', async () => {
    const desk = await freshDesk();
    presetStore.addWidget('tabs');
    const frame = desk.widgets.at(-1)!;
    presetStore.addWidget('button');
    const kid = desk.widgets.at(-1)!;
    const a = desk.widgets[0]!;
    const { deskChanges } = await import('./changes');
    const deleted: string[] = [];
    const stop = deskChanges.on((c) => deleted.push(...(c.deleted ?? [])));
    presetStore.removeWidgets([a.id, frame.id]);
    stop();
    expect(deleted.sort()).toEqual([`w/${a.id}`, `w/${frame.id}`, `w/${kid.id}`].sort());
  });
});
