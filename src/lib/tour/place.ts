// Where the tour's popup goes beside what a step highlights. Pure; tested in place.test.ts.
// Like the tooltip's `placeTip` (lib/ui/tooltip.ts), which only goes above or below.
import type { Box } from '../ui/tooltip';

export type Side = 'below' | 'above' | 'right' | 'left' | 'over' | 'centre';

export interface Size {
  width: number;
  height: number;
}

/**
 * The popup's top-left corner. Below the target when it fits, else above, right or left. When
 * the target leaves room on no side (it fills most of the screen), the popup sits inside it,
 * along its bottom edge. With no target it is centred. Always kept `margin` inside the viewport.
 */
export function placePopup(
  target: Box | null,
  size: Size,
  viewport: Size,
  gap = 12,
  margin = 8,
): { left: number; top: number; side: Side } {
  const clampX = (x: number) => Math.max(margin, Math.min(x, viewport.width - size.width - margin));
  const clampY = (y: number) =>
    Math.max(margin, Math.min(y, viewport.height - size.height - margin));
  if (!target) {
    return {
      left: clampX((viewport.width - size.width) / 2),
      top: clampY((viewport.height - size.height) / 2),
      side: 'centre',
    };
  }
  const right = target.left + target.width;
  const bottom = target.top + target.height;
  const midX = target.left + target.width / 2 - size.width / 2;
  const midY = target.top + target.height / 2 - size.height / 2;
  const fitsY = size.height + gap + margin;
  const fitsX = size.width + gap + margin;
  if (viewport.height - bottom >= fitsY)
    return { left: clampX(midX), top: bottom + gap, side: 'below' };
  if (target.top >= fitsY)
    return { left: clampX(midX), top: target.top - gap - size.height, side: 'above' };
  if (viewport.width - right >= fitsX)
    return { left: right + gap, top: clampY(midY), side: 'right' };
  if (target.left >= fitsX)
    return { left: target.left - gap - size.width, top: clampY(midY), side: 'left' };
  return {
    left: clampX(midX),
    top: clampY(Math.min(bottom, viewport.height) - gap - size.height),
    side: 'over',
  };
}

/** The part of `box` inside a `width` × `height` screen, `inset` from its edges (so a frame
    drawn on it stays visible). */
export function clampBox(box: Box, width: number, height: number, inset = 2): Box {
  const left = Math.max(box.left, inset);
  const top = Math.max(box.top, inset);
  const right = Math.min(box.left + box.width, width - inset);
  const bottom = Math.min(box.top + box.height, height - inset);
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/** The smallest box around all of `boxes` (null for none). */
export function unionBox(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;
  const left = Math.min(...boxes.map((b) => b.left));
  const top = Math.min(...boxes.map((b) => b.top));
  const right = Math.max(...boxes.map((b) => b.left + b.width));
  const bottom = Math.max(...boxes.map((b) => b.top + b.height));
  return { left, top, width: right - left, height: bottom - top };
}
