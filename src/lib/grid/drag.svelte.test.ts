import { beforeEach, describe, expect, it } from 'vitest';
import type { TabRef } from '../model/preset';
import { DragSession, type DropTarget, type PointerNews } from './drag.svelte';
import { moveRect, pxToCells, type Box, type Handle, type Placed } from './engine';

// The desk at the origin: 12×8 cells of 100×50, gap 10. A frame on it at x6 y2, 4×4 cells
// (670, 130 – 1100, 360), its tab canvas at (680, 160), 2×2 cells of 190×80, gap 10.
const deskEl = {} as Element;
const tabEl = {} as Element;
const boxes = new Map<Element, Box>([
  [deskEl, { left: 0, top: 0, width: 1330, height: 490 }],
  [tabEl, { left: 680, top: 160, width: 410, height: 190 }],
]);
const deskMetrics = { cellW: 100, cellH: 50, gap: 10 };
const T1: TabRef = { widget: 'frame', tab: 't1' };
const T2: TabRef = { widget: 'frame', tab: 't2' };

let button: Placed;
let kid: Placed;
let deskItems: Placed[];
let tabItems: Placed[];
let shown: TabRef;
let commits: [Placed[], TabRef | null][];
let ticks: number;
let session: DragSession;

const deskTarget = (): DropTarget => ({
  at: null,
  element: deskEl,
  grid: { cols: 12, rows: 8 },
  metrics: deskMetrics,
  widgets: deskItems,
});
const tabTarget = (): DropTarget => ({
  at: shown,
  element: tabEl,
  grid: { cols: 2, rows: 2 },
  metrics: { cellW: 190, cellH: 80, gap: 10 },
  widgets: tabItems,
});

const news = (type: string, x: number, y: number, more: Partial<PointerNews> = {}) =>
  session.follow({
    type,
    pointerId: 1,
    pointerType: 'touch',
    buttons: 1,
    clientX: x,
    clientY: y,
    ...more,
  });
/** Lifts widgets with the pointer at (x0, y0), from the desk or a tab: moved, or resized. */
const lift = (
  ws: Placed | Placed[],
  from: TabRef | null,
  x0: number,
  y0: number,
  kind: 'move' | Handle = 'move',
  s = session,
) => {
  const all = [ws].flat();
  return s.lift(
    { kind, ids: all.map((w) => w.id), from, pointerId: 1, x0, y0, rects: () => all },
    x0,
    y0,
  );
};

beforeEach(() => {
  button = { id: 'button', x: 0, y: 0, w: 1, h: 1 };
  kid = { id: 'kid', x: 1, y: 1, w: 1, h: 1 };
  deskItems = [button, { id: 'frame', x: 6, y: 2, w: 4, h: 4 }];
  tabItems = [kid];
  shown = T1;
  commits = [];
  ticks = 0;
  session = new DragSession({
    accepts: (id) => id !== 'frame',
    commit: (rects, at) => commits.push([[...rects], at]),
    measure: (el) => boxes.get(el)!,
    tick: () => ticks++,
  });
  session.register(deskTarget);
  session.register(tabTarget);
});

describe('carrying a widget', () => {
  it('carries one at a time', () => {
    expect(lift(button, null, 50, 30)).toBe(true);
    expect(lift(kid, T1, 700, 180)).toBe(false);
    expect(session.lifted?.ids).toEqual(['button']);
  });

  it('lands where moveRect would, in its own grid', () => {
    lift(button, null, 50, 30);
    news('pointermove', 50 + 225, 30 + 65);
    const { dCols, dRows } = pxToCells(225, 65, deskMetrics);
    const rect = moveRect(button, dCols, dRows, { cols: 12, rows: 8 });
    expect(session.drop).toEqual({ at: null, rects: [{ id: 'button', ...rect }], valid: true });
    expect(session.offset).toEqual({ x: 225, y: 65 });
    news('pointerup', 275, 95);
    expect(commits).toEqual([[[{ id: 'button', x: 2, y: 1, w: 1, h: 1 }], null]]);
    expect(session.lifted).toBeNull();
  });

  it('puts a desk widget on the frame’s tab the pointer is over', () => {
    lift(button, null, 50, 30);
    // Top-left at (660, 160): the first cell of the tab.
    news('pointermove', 700, 180);
    expect(session.drop).toEqual({
      at: T1,
      rects: [{ id: 'button', x: 0, y: 0, w: 1, h: 1 }],
      valid: true,
    });
    // Over the frame's border, outside its tab canvas: still the frame.
    news('pointermove', 675, 140);
    expect(session.drop?.at).toEqual(T1);
    news('pointerup', 700, 180);
    expect(commits).toEqual([[[{ id: 'button', x: 0, y: 0, w: 1, h: 1 }], T1]]);
  });

  it('never puts a widget down where it may not go, nor on taken cells', () => {
    const frame = deskItems[1]!;
    lift(frame, null, 680, 140);
    news('pointermove', 690, 150);
    expect(session.drop?.at).toBeNull(); // a frame never goes on a tab
    session.cancel();
    lift(button, null, 50, 30);
    // Top-left at (860, 240): the kid's cell.
    news('pointermove', 900, 260);
    expect(session.drop).toMatchObject({ at: T1, valid: false });
    news('pointerup', 900, 260);
    expect(commits).toEqual([]);
  });

  it('puts it back on a cancel, or a mouse whose button came up elsewhere', () => {
    lift(button, null, 50, 30);
    news('pointermove', 275, 95);
    news('pointercancel', 275, 95);
    expect(session.lifted).toBeNull();
    lift(button, null, 50, 30);
    news('pointermove', 275, 95, { pointerType: 'mouse', buttons: 0 });
    expect(session.lifted).toBeNull();
    // Another pointer changes nothing.
    lift(button, null, 50, 30);
    news('pointerup', 275, 95, { pointerId: 2 });
    expect(session.lifted?.ids).toEqual(['button']);
    session.cancel();
    expect(commits).toEqual([]);
  });

  it('follows the frame it came from to the tab it shows now', () => {
    lift(kid, T1, 1000, 270);
    shown = T2;
    tabItems = [];
    news('pointermove', 790, 180);
    news('pointerup', 790, 180);
    expect(commits).toEqual([[[{ id: 'kid', x: 0, y: 0, w: 1, h: 1 }], T2]]);
  });

  it('falls back to the desk when the frame goes', () => {
    const session2 = new DragSession({
      accepts: () => true,
      commit: () => {},
      measure: (el) => boxes.get(el)!,
    });
    session2.register(deskTarget);
    const off = session2.register(tabTarget);
    lift(button, null, 50, 30, 'move', session2);
    session2.follow({
      type: 'pointermove',
      pointerId: 1,
      pointerType: 'touch',
      buttons: 1,
      clientX: 700,
      clientY: 180,
    });
    expect(session2.drop?.at).toEqual(T1);
    off();
    expect(session2.drop?.at).toBeNull();
  });

  it('ends the drag only when a widget carried goes away', () => {
    const other = { id: 'other', x: 2, y: 0, w: 1, h: 1 };
    lift([button, other], null, 50, 30);
    session.forget('kid');
    expect(session.lifted?.ids).toEqual(['button', 'other']);
    session.forget('other');
    expect(session.lifted).toBeNull();
  });

  it('ticks only when where it would land changes', () => {
    lift(button, null, 50, 30);
    news('pointermove', 52, 31);
    expect(ticks).toBe(0);
    news('pointermove', 50 + 110, 30);
    expect(ticks).toBe(1);
    news('pointermove', 50 + 112, 32);
    expect(ticks).toBe(1);
  });
});

describe('carrying and resizing a selection', () => {
  const other = { id: 'other', x: 2, y: 0, w: 1, h: 1 };

  it('carries them all alike, keeping their places to each other', () => {
    deskItems.push(other);
    lift([button, other], null, 50, 30);
    news('pointermove', 50 + 110, 30 + 60);
    expect(session.drop).toEqual({
      at: null,
      rects: [
        { id: 'button', x: 1, y: 1, w: 1, h: 1 },
        { id: 'other', x: 3, y: 1, w: 1, h: 1 },
      ],
      valid: true,
    });
    news('pointerup', 160, 90);
    expect(commits[0]![0].map((r) => r.id)).toEqual(['button', 'other']);
  });

  it('takes them onto a tab only if it fits them all and takes them all', () => {
    lift([button, other], null, 50, 30);
    // Their top-left on the tab's first cell: 'other' would be past its 2 columns.
    news('pointermove', 700, 180);
    expect(session.drop).toMatchObject({ at: T1, valid: false });
    session.cancel();
    const frame = deskItems[1]!;
    lift([button, frame], null, 50, 30);
    news('pointermove', 700, 180);
    expect(session.drop?.at).toBeNull();
  });

  it('resizes them all alike, in their own grid, refused where one would overlap', () => {
    deskItems.push(other);
    lift([button, other], null, 100, 50, 'se');
    news('pointermove', 100 + 110, 50 + 60);
    expect(session.offset).toEqual({ x: 0, y: 0 });
    expect(session.drop).toEqual({
      at: null,
      rects: [
        { id: 'button', x: 0, y: 0, w: 2, h: 2 },
        { id: 'other', x: 2, y: 0, w: 2, h: 2 },
      ],
      valid: true,
    });
    // Two cells wider each: button would cover other.
    news('pointermove', 100 + 220, 50);
    expect(session.drop?.valid).toBe(false);
    news('pointerup', 320, 50);
    expect(commits).toEqual([]);
    lift([button, other], null, 100, 50, 's');
    news('pointerup', 100, 50 + 60);
    expect(commits).toEqual([
      [
        [
          { id: 'button', x: 0, y: 0, w: 1, h: 2 },
          { id: 'other', x: 2, y: 0, w: 1, h: 2 },
        ],
        null,
      ],
    ]);
  });
});

describe('registering', () => {
  it('sees what is on a grid as it is now', () => {
    const items: Placed[] = $state([]);
    const s = new DragSession({
      accepts: () => true,
      commit: () => {},
      measure: (el) => boxes.get(el)!,
    });
    s.register(() => ({ ...deskTarget(), widgets: items }));
    lift(button, null, 50, 30, 'move', s);
    expect(s.drop?.valid).toBe(true);
    items.push({ id: 'other', x: 0, y: 0, w: 1, h: 1 });
    expect(s.drop?.valid).toBe(false);
  });
});
