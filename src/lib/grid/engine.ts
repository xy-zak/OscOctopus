// Pure grid math: no DOM, no Svelte. Everything here is unit-tested in engine.test.ts.
//
// The desk is a fixed cols × rows grid that stretches to fill the viewport. Widgets are placed
// freely; nothing ever moves on its own (no gravity / compaction), because a control surface
// that rearranges itself breaks muscle memory.
import { clamp } from '../util';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GridSize {
  cols: number;
  rows: number;
}

export interface Placed extends Rect {
  id: string;
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export interface Metrics {
  cellW: number;
  cellH: number;
  gap: number;
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function inBounds(r: Rect, grid: GridSize): boolean {
  return (
    r.x >= 0 && r.y >= 0 && r.w >= 1 && r.h >= 1 && r.x + r.w <= grid.cols && r.y + r.h <= grid.rows
  );
}

/** Ids of every item `r` would overlap, ignoring `selfId`. */
export function collisions(r: Rect, items: readonly Placed[], selfId?: string): string[] {
  return items.filter((it) => it.id !== selfId && overlaps(r, it)).map((it) => it.id);
}

export function isFree(
  r: Rect,
  grid: GridSize,
  items: readonly Placed[],
  selfId?: string,
): boolean {
  return inBounds(r, grid) && collisions(r, items, selfId).length === 0;
}

/** Keeps a rect inside the grid, shrinking it if the grid is smaller than the rect. */
export function clampRect(r: Rect, grid: GridSize): Rect {
  const w = clamp(Math.round(r.w), 1, grid.cols);
  const h = clamp(Math.round(r.h), 1, grid.rows);
  return {
    w,
    h,
    x: clamp(Math.round(r.x), 0, grid.cols - w),
    y: clamp(Math.round(r.y), 0, grid.rows - h),
  };
}

/** Moves by a (fractional) number of cells; snaps to the nearest cell and stays in bounds. */
export function moveRect(r: Rect, dCols: number, dRows: number, grid: GridSize): Rect {
  return clampRect({ ...r, x: r.x + dCols, y: r.y + dRows }, grid);
}

/** Resizes from a handle by a (fractional) number of cells, keeping the opposite edge fixed. */
export function resizeRect(
  r: Rect,
  handle: Handle,
  dCols: number,
  dRows: number,
  grid: GridSize,
): Rect {
  let { x, y, w, h } = r;
  const dx = Math.round(dCols);
  const dy = Math.round(dRows);
  if (handle.includes('e')) w = clamp(w + dx, 1, grid.cols - x);
  if (handle.includes('s')) h = clamp(h + dy, 1, grid.rows - y);
  if (handle.includes('w')) {
    const nx = clamp(x + dx, 0, x + w - 1);
    w += x - nx;
    x = nx;
  }
  if (handle.includes('n')) {
    const ny = clamp(y + dy, 0, y + h - 1);
    h += y - ny;
    y = ny;
  }
  return { x, y, w, h };
}

/** First free spot for a w × h item, scanning row by row. Null if the grid is full. */
export function findFreeSpot(
  size: { w: number; h: number },
  grid: GridSize,
  items: readonly Placed[],
): Rect | null {
  for (let y = 0; y + size.h <= grid.rows; y++) {
    for (let x = 0; x + size.w <= grid.cols; x++) {
      const r = { x, y, ...size };
      if (collisions(r, items).length === 0) return r;
    }
  }
  return null;
}

/** Id of the reserved cell in collision checks; never a real widget id. */
export const EDIT_CELL_ID = '__edit';

/**
 * The top-right two cells always hold the desk's EDIT / LIVE switch, so no widget may use them.
 * They move with the right edge when the column count changes.
 */
export function editCell(grid: GridSize): Placed {
  const w = Math.min(2, grid.cols);
  return { id: EDIT_CELL_ID, x: grid.cols - w, y: 0, w, h: 1 };
}

/** Widgets plus the reserved EDIT cell: what placement and collision checks run against. */
export function withEditCell(items: readonly Placed[], grid: GridSize): Placed[] {
  return [...items, editCell(grid)];
}

/** Items that no longer fit after the grid shrinks. */
export function outOfBounds(items: readonly Placed[], grid: GridSize): string[] {
  return items.filter((it) => !inBounds(it, grid)).map((it) => it.id);
}

export function metrics(width: number, height: number, grid: GridSize, gap: number): Metrics {
  return {
    gap,
    cellW: Math.max(0, (width - gap * (grid.cols + 1)) / grid.cols),
    cellH: Math.max(0, (height - gap * (grid.rows + 1)) / grid.rows),
  };
}

/** Pixel box of a grid rect inside the canvas (the canvas has a `gap` margin on every side). */
export function toPx(r: Rect, m: Metrics) {
  return {
    left: m.gap + r.x * (m.cellW + m.gap),
    top: m.gap + r.y * (m.cellH + m.gap),
    width: r.w * m.cellW + (r.w - 1) * m.gap,
    height: r.h * m.cellH + (r.h - 1) * m.gap,
  };
}

/** Converts a pixel delta to a cell delta. */
export function pxToCells(dx: number, dy: number, m: Metrics) {
  return { dCols: dx / (m.cellW + m.gap || 1), dRows: dy / (m.cellH + m.gap || 1) };
}
