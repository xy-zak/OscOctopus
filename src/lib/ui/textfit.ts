// Everything uses one monospace font at one size, so "does this text fit?" is arithmetic:
// characters × character width. Widgets use this to switch labels to vertical when a
// horizontal label would not fit (e.g. a one-column fader).
import { createSubscriber } from 'svelte/reactivity';

let chPx = 7.8; // JetBrains Mono at 13px; replaced by a real measurement at startup.

/** Measures the real character width once the UI font (regular and bold) has loaded. */
export async function measureCharWidth(): Promise<number> {
  try {
    await Promise.all([
      document.fonts.load(`13px "JetBrainsMono NFM"`),
      document.fonts.load(`bold 13px "JetBrainsMono NFM"`),
    ]);
    await document.fonts.ready;
  } catch {
    // Fall back to the estimate.
  }
  const probe = document.createElement('span');
  probe.textContent = '0'.repeat(100);
  probe.style.cssText =
    'position:absolute;visibility:hidden;white-space:pre;font:var(--fs) var(--font)';
  document.body.appendChild(probe);
  const w = probe.getBoundingClientRect().width / 100;
  probe.remove();
  if (w > 0) chPx = w;
  return chPx;
}

export function charWidth(): number {
  return chPx;
}

/**
 * Called in an effect, runs it again whenever a font finishes loading: text measured in the DOM
 * before then was measured in another font (text widgets, widgets/text/fit.ts).
 */
export const trackFonts = createSubscriber((update) => {
  const fonts = document.fonts;
  fonts.addEventListener('loadingdone', update);
  return () => fonts.removeEventListener('loadingdone', update);
});

/** Whether `text` plus `padCh` characters of padding fits in `px`. Pure; tested. */
export function fitsIn(text: string, px: number, ch = chPx, padCh = 2): boolean {
  return (Array.from(text).length + padCh) * ch <= px;
}

export type Orientation = 'horizontal' | 'vertical' | 'none';

/**
 * Where a label can go in a w × h box: horizontal if it fits across, otherwise vertical if it
 * fits down, otherwise nowhere (callers truncate or hide).
 */
export function orientFor(text: string, w: number, h: number, ch = chPx, padCh = 2): Orientation {
  if (fitsIn(text, w, ch, padCh)) return 'horizontal';
  if (fitsIn(text, h, ch, padCh)) return 'vertical';
  return 'none';
}
