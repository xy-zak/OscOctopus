import { describe, expect, it } from 'vitest';
import {
  clampRect,
  collisions,
  findFreeSpot,
  isFree,
  metrics,
  moveRect,
  outOfBounds,
  pxToCells,
  resizeRect,
  toPx,
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
