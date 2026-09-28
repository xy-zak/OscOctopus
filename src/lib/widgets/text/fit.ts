// How big a text widget's text is: as large as its size allows (FIT: as large as its box), and
// smaller until the wrapped text fits the box. At the smallest size, what still doesn't fit is
// cut after the last line that does, with an ellipsis (a line clamp).
//
// Measured in the DOM (Text.svelte calls `fitText`), since where the text wraps depends on its
// words. The search itself is pure and tested (fit.test.ts).
import type { TextProps } from '../../model/preset';

/** The largest each size draws the text, in CSS px (FIT: bounded only by the box). */
export const TEXT_PX: Record<TextProps['size'], number> = {
  fit: 240,
  s: 13,
  m: 20,
  l: 26,
  xl: 39,
};

/** The smallest the text shrinks to before it is cut. */
export const MIN_TEXT_PX = 10;

/**
 * The largest whole number in lo…hi for which `fits` holds, and whether it does (false: none
 * does, and the answer is `lo`). `fits` must hold up to some number and fail above it. `hint`,
 * the last answer, is tried first: when little changed, that settles it in two measurements.
 */
export function largestFitting(
  lo: number,
  hi: number,
  fits: (n: number) => boolean,
  hint?: number,
): { n: number; fits: boolean } {
  if (hi < lo) return { n: lo, fits: fits(lo) };
  let good = lo - 1;
  let bad = hi + 1;
  if (hint !== undefined && hint >= lo && hint <= hi) {
    if (fits(hint)) {
      if (hint === hi || !fits(hint + 1)) return { n: hint, fits: true };
      good = hint + 1;
    } else bad = hint;
  }
  while (bad - good > 1) {
    const mid = Math.floor((good + bad) / 2);
    if (fits(mid)) good = mid;
    else bad = mid;
  }
  return good < lo ? { n: lo, fits: false } : { n: good, fits: true };
}

/**
 * Sizes the text in `flow` to fit `box` (its container, which it must not overflow), up to
 * `maxPx`. Sets `--text-px` on the box (base.css draws the text at it) and, when even the
 * smallest size overflows, clamps `flow` to the lines that fit (`data-clamped` plus
 * -webkit-line-clamp, which draws the ellipsis). Returns the size, to pass back as `last`.
 */
export function fitText(box: HTMLElement, flow: HTMLElement, maxPx: number, last?: number): number {
  const setPx = (px: number) => box.style.setProperty('--text-px', `${px}px`);
  const overflows = () =>
    flow.offsetHeight > box.clientHeight || flow.scrollWidth > box.clientWidth;

  delete flow.dataset.clamped;
  flow.style.removeProperty('-webkit-line-clamp');
  // A line is at least as tall as its font: no size above the box's height can fit.
  const hi = Math.max(MIN_TEXT_PX, Math.min(maxPx, box.clientHeight));
  const size = largestFitting(
    MIN_TEXT_PX,
    hi,
    (px) => {
      setPx(px);
      return !overflows();
    },
    last,
  );
  setPx(size.n);
  if (size.fits) return size.n;

  // Too much text even at the smallest size: keep as many lines as fit. A clamped flow is as
  // tall as its first n lines; every line is at least MIN_TEXT_PX tall.
  flow.dataset.clamped = '';
  const clampTo = (n: number) => flow.style.setProperty('-webkit-line-clamp', String(n));
  const lines = largestFitting(1, Math.ceil(flow.offsetHeight / MIN_TEXT_PX), (n) => {
    clampTo(n);
    return flow.offsetHeight <= box.clientHeight;
  });
  clampTo(lines.n);
  return size.n;
}
