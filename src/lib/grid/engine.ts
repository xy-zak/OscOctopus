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

/**
 * Whether items can all be at `rects` at once (a selection moved or resized together): each
 * inside the grid, none on another of `items` (they themselves aside) nor on each other.
 */
export function allFree(
  rects: readonly Placed[],
  grid: GridSize,
  items: readonly Placed[],
): boolean {
  const moving = new Set(rects.map((r) => r.id));
  const rest = items.filter((it) => !moving.has(it.id));
  return rects.every(
    (r, i) => isFree(r, grid, rest) && rects.slice(i + 1).every((o) => !overlaps(r, o)),
  );
}

/** The smallest rect around rects (at least one). */
export function bounds(rects: readonly Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const w = Math.max(...rects.map((r) => r.x + r.w)) - x;
  const h = Math.max(...rects.map((r) => r.y + r.h)) - y;
  return { x, y, w, h };
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

/** Items resized alike: from the same handle by the same number of cells, each kept in the grid. */
export function resizeAll(
  rects: readonly Placed[],
  handle: Handle,
  dCols: number,
  dRows: number,
  grid: GridSize,
): Placed[] {
  return rects.map((r) => ({ id: r.id, ...resizeRect(r, handle, dCols, dRows, grid) }));
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

/**
 * Room for a new item of up to w × h: that size if it fits anywhere, else the largest smaller
 * one that does (most cells first, then the wider). Null if the grid is full.
 */
export function findRoom(
  size: { w: number; h: number },
  grid: GridSize,
  items: readonly Placed[],
): Rect | null {
  const sizes: { w: number; h: number }[] = [];
  for (let w = Math.min(size.w, grid.cols); w >= 1; w--) {
    for (let h = Math.min(size.h, grid.rows); h >= 1; h--) sizes.push({ w, h });
  }
  sizes.sort((a, b) => b.w * b.h - a.w * a.h || b.w - a.w);
  for (const s of sizes) {
    const spot = findFreeSpot(s, grid, items);
    if (spot) return spot;
  }
  return null;
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

// ---- carrying items between grids (drag.svelte.ts) -------------------------------------------

/** A box on screen, in CSS px. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Whether a point is in a box; its right and bottom edges belong to the next box. */
export const within = (b: Box, x: number, y: number) =>
  x >= b.left && x < b.left + b.width && y >= b.top && y < b.top + b.height;

/** The (fractional) cell at a point of the canvas: `toPx` backwards, for a rect's top-left. */
export function cellAt(left: number, top: number, m: Metrics) {
  return { x: (left - m.gap) / (m.cellW + m.gap || 1), y: (top - m.gap) / (m.cellH + m.gap || 1) };
}

/**
 * Where an item of `size` lands with its top-left at a point of the canvas: on the nearest cell,
 * inside the grid (shrunk if it is bigger). In its own grid, the same as `moveRect` by the
 * distance moved.
 */
export function snapTo(
  left: number,
  top: number,
  size: { w: number; h: number },
  grid: GridSize,
  m: Metrics,
): Rect {
  return clampRect({ ...cellAt(left, top, m), w: size.w, h: size.h }, grid);
}

/** A grid an item can be put down on: where it is on screen, and what is on it already. */
export interface Ground<K> {
  /** Which grid it is (null: the desk's). */
  at: K | null;
  /** Its canvas on screen: where its cells are. */
  box: Box;
  /** Where the pointer counts as over it, when that is more than its canvas (a frame's box). */
  hit?: Box;
  grid: GridSize;
  metrics: Metrics;
  items: readonly Placed[];
}

/** Where carried items would land, and whether they may. */
export interface Landing<K> {
  at: K | null;
  rects: Placed[];
  valid: boolean;
}

/**
 * Where carried items land: in the first of `frames` the pointer is over, else on the desk, the
 * top-left of them all at `at` on screen (asked of the grid they land on: a new widget is held
 * by its middle, whatever the size of that grid's cells). They move alike, so they keep their
 * places to each other. One item alone is kept inside the grid, shrunk if it is bigger; several
 * never shrink, so they are refused where they don't fit. Valid when all their cells there are
 * free.
 */
export function landing<K>(
  items: readonly Placed[],
  at: (g: Ground<K>) => { left: number; top: number },
  pointer: { x: number; y: number },
  desk: Ground<K>,
  frames: readonly Ground<K>[],
): Landing<K> {
  const g = frames.find((f) => within(f.hit ?? f.box, pointer.x, pointer.y)) ?? desk;
  const around = bounds(items);
  const { left, top } = at(g);
  const to = snapTo(left - g.box.left, top - g.box.top, around, g.grid, g.metrics);
  const rects =
    items.length === 1
      ? [{ id: items[0]!.id, ...to }]
      : items.map(({ id, x, y, w, h }) => ({
          id,
          x: x + to.x - around.x,
          y: y + to.y - around.y,
          w,
          h,
        }));
  return { at: g.at, rects, valid: allFree(rects, g.grid, g.items) };
}
