import { describe, expect, it } from 'vitest';
import {
  cellAt,
  clampRect,
  collisions,
  findFreeSpot,
  findRoom,
  isFree,
  landing,
  metrics,
  moveRect,
  outOfBounds,
  pxToCells,
  resizeRect,
  snapTo,
  toPx,
  within,
  type Ground,
  type Placed,
} from './engine';

const grid = { cols: 12, rows: 8 };
const items: Placed[] = [
  { id: 'a', x: 0, y: 0, w: 2, h: 2 },
  { id: 'b', x: 4, y: 0, w: 1, h: 4 },
];

describe('collisions', () => {
  it('detects overlap but not edge contact', () => {
    expect(collisions({ x: 1, y: 1, w: 2, h: 2 }, items)).toEqual(['a']);
    expect(collisions({ x: 2, y: 0, w: 2, h: 2 }, items)).toEqual([]);
  });
  it('ignores the item being moved', () => {
    expect(isFree({ x: 0, y: 0, w: 2, h: 2 }, grid, items, 'a')).toBe(true);
    expect(isFree({ x: 0, y: 0, w: 2, h: 2 }, grid, items)).toBe(false);
  });
  it('treats out-of-bounds as not free', () => {
    expect(isFree({ x: 11, y: 0, w: 2, h: 1 }, grid, items)).toBe(false);
  });
});

describe('moveRect', () => {
  it('snaps fractional deltas to the nearest cell', () => {
    expect(moveRect({ x: 0, y: 0, w: 2, h: 2 }, 1.6, 0.4, grid)).toEqual({
      x: 2,
      y: 0,
      w: 2,
      h: 2,
    });
  });
  it('clamps to the grid', () => {
    expect(moveRect({ x: 0, y: 0, w: 2, h: 2 }, 50, -3, grid)).toEqual({ x: 10, y: 0, w: 2, h: 2 });
  });
});

describe('resizeRect', () => {
  const r = { x: 2, y: 2, w: 2, h: 2 };
  it('grows from the south-east corner', () => {
    expect(resizeRect(r, 'se', 1, 2, grid)).toEqual({ x: 2, y: 2, w: 3, h: 4 });
  });
  it('keeps the opposite edge fixed from the north-west corner', () => {
    expect(resizeRect(r, 'nw', -1, -1, grid)).toEqual({ x: 1, y: 1, w: 3, h: 3 });
    expect(resizeRect(r, 'nw', 5, 5, grid)).toEqual({ x: 3, y: 3, w: 1, h: 1 });
  });
  it('never exceeds the grid', () => {
    expect(resizeRect(r, 'e', 100, 0, grid)).toEqual({ x: 2, y: 2, w: 10, h: 2 });
    expect(resizeRect(r, 'n', 0, -100, grid)).toEqual({ x: 2, y: 0, w: 2, h: 4 });
  });
});

describe('findFreeSpot', () => {
  it('finds the first gap row by row', () => {
    expect(findFreeSpot({ w: 2, h: 2 }, grid, items)).toEqual({ x: 2, y: 0, w: 2, h: 2 });
  });
  it('returns null when full', () => {
    expect(
      findFreeSpot({ w: 1, h: 1 }, { cols: 1, rows: 1 }, [{ id: 'x', x: 0, y: 0, w: 1, h: 1 }]),
    ).toBeNull();
  });
});

describe('findRoom', () => {
  it('takes the size asked for when it fits, else the largest that does', () => {
    expect(findRoom({ w: 2, h: 2 }, grid, items)).toEqual({ x: 2, y: 0, w: 2, h: 2 });
    const tight = { cols: 4, rows: 3 };
    const taken = [{ id: 'a', x: 0, y: 0, w: 4, h: 1 }];
    expect(findRoom({ w: 6, h: 4 }, tight, taken)).toEqual({ x: 0, y: 1, w: 4, h: 2 });
    expect(
      findRoom({ w: 1, h: 1 }, { cols: 1, rows: 1 }, [{ id: 'x', x: 0, y: 0, w: 1, h: 1 }]),
    ).toBeNull();
  });
});

describe('clampRect / outOfBounds', () => {
  it('shrinks items bigger than the grid', () => {
    expect(clampRect({ x: 0, y: 0, w: 20, h: 3 }, grid)).toEqual({ x: 0, y: 0, w: 12, h: 3 });
  });
  it('reports items that no longer fit', () => {
    expect(outOfBounds(items, { cols: 4, rows: 8 })).toEqual(['b']);
  });
});

describe('pixel metrics', () => {
  const m = metrics(12 * 100 + 13 * 10, 8 * 50 + 9 * 10, grid, 10);
  it('computes cell size from the container', () => {
    expect(m.cellW).toBeCloseTo(100);
    expect(m.cellH).toBeCloseTo(50);
  });
  it('maps rects to pixels including gaps', () => {
    expect(toPx({ x: 1, y: 1, w: 2, h: 2 }, m)).toEqual({
      left: 120,
      top: 70,
      width: 210,
      height: 110,
    });
  });
  it('maps pixel deltas back to cells', () => {
    expect(pxToCells(220, 60, m)).toEqual({ dCols: 2, dRows: 1 });
  });
});

describe('carrying between grids', () => {
  const m = metrics(12 * 100 + 13 * 10, 8 * 50 + 9 * 10, grid, 10);
  const box = (left: number, top: number, width: number, height: number) => ({
    left,
    top,
    width,
    height,
  });

  it('finds the cell at a point, the way back from toPx', () => {
    const r = { x: 3, y: 2, w: 1, h: 1 };
    const px = toPx(r, m);
    expect(cellAt(px.left, px.top, m)).toEqual({ x: 3, y: 2 });
  });

  it('lands where moveRect would, for a move in its own grid', () => {
    const r = { x: 4, y: 3, w: 2, h: 2 };
    const px = toPx(r, m);
    for (const dx of [-900, -130, -54, 0, 13, 56, 166, 700, 2000]) {
      for (const dy of [-400, -31, 0, 24, 61, 330]) {
        const { dCols, dRows } = pxToCells(dx, dy, m);
        expect(snapTo(px.left + dx, px.top + dy, r, grid, m)).toEqual(
          moveRect(r, dCols, dRows, grid),
        );
      }
    }
  });

  it('shrinks an item too big for the grid it lands on', () => {
    expect(snapTo(10, 10, { w: 20, h: 3 }, { cols: 6, rows: 4 }, m)).toEqual({
      x: 0,
      y: 0,
      w: 6,
      h: 3,
    });
  });

  it('counts a box’s left and top edges in, its right and bottom out', () => {
    const b = box(10, 10, 20, 20);
    expect(within(b, 10, 10)).toBe(true);
    expect(within(b, 29.5, 29.5)).toBe(true);
    expect(within(b, 30, 15)).toBe(false);
    expect(within(b, 15, 30)).toBe(false);
  });

  describe('landing', () => {
    // The desk at the origin; a frame on it whose tab canvas (2×2 cells of 50×50, gap 10) is at
    // (300, 300), inside the frame's whole box at (290, 270).
    const desk: Ground<string> = { at: null, box: box(0, 0, 1330, 490), grid, metrics: m, items };
    const tabGrid = { cols: 2, rows: 2 };
    const tabM = { cellW: 50, cellH: 50, gap: 10 };
    const frame: Ground<string> = {
      at: 'tab',
      box: box(300, 300, 130, 130),
      hit: box(290, 270, 150, 170),
      grid: tabGrid,
      metrics: tabM,
      items: [{ id: 'kid', x: 1, y: 1, w: 1, h: 1 }],
    };
    const item: Placed = { id: 'me', x: 0, y: 0, w: 1, h: 1 };

    it('lands in a frame the pointer is over, its border and tabs too', () => {
      expect(landing(item, 310, 310, { x: 330, y: 330 }, desk, [frame])).toEqual({
        at: 'tab',
        rect: { x: 0, y: 0, w: 1, h: 1 },
        valid: true,
      });
      // Over the tab strip, above the canvas: still the frame, the item kept in its grid.
      expect(landing(item, 310, 250, { x: 300, y: 280 }, desk, [frame]).at).toBe('tab');
    });

    it('lands on the desk off every frame', () => {
      const l = landing(item, 230, 70, { x: 250, y: 90 }, desk, [frame]);
      expect(l).toEqual({ at: null, rect: { x: 2, y: 1, w: 1, h: 1 }, valid: true });
    });

    it('is refused on taken cells, never on its own', () => {
      expect(landing(item, 370, 370, { x: 380, y: 380 }, desk, [frame]).valid).toBe(false);
      const kid = { ...item, id: 'kid' };
      expect(landing(kid, 370, 370, { x: 380, y: 380 }, desk, [frame]).valid).toBe(true);
      // On the desk: items 'a' covers (0,0)–(1,1).
      expect(landing(item, 10, 10, { x: 20, y: 20 }, desk, []).valid).toBe(false);
    });
  });
});
