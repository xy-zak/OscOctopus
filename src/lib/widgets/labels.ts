// Where a widget's title and value readout go (WidgetFrame): set into the frame's border, the
// same in every skin. Pure; tested in labels.test.ts.
//
// One rule: horizontal if it fits, otherwise vertical along a side border, otherwise hidden
// (a title that doesn't fit across is truncated if there is room for a few characters). The
// font size never changes, and one monospace font makes "does it fit?" arithmetic.
import { fitsIn, orientFor } from '../ui/textfit';

export type TitlePos = 'top' | 'left' | 'none';
export type StatusPos = 'top' | 'bottom' | 'right' | 'none';

export function labelLayout(
  title: string,
  status: string,
  w: number,
  h: number,
  ch: number,
): { titlePos: TitlePos; statusPos: StatusPos } {
  // Border length available for text: minus a corner and a gap at each end.
  const across = w - 3 * ch;
  const down = h - 3 * ch;
  const tLen = title ? Array.from(title).length + 2 : 0;
  const sLen = status ? Array.from(status).length + 2 : 0;
  let titlePos: TitlePos = 'none';
  if (title) {
    const o = orientFor(title, across, down, ch);
    if (o === 'horizontal') titlePos = 'top';
    else if (o === 'vertical') titlePos = 'left';
    else if (across >= 6 * ch) titlePos = 'top'; // truncated with an ellipsis
  }
  let statusPos: StatusPos = 'none';
  if (status) {
    if (titlePos === 'top' && (tLen + sLen + 1) * ch <= across) statusPos = 'top';
    else if (!title && fitsIn(status, across, ch)) statusPos = 'top';
    else if (fitsIn(status, across, ch)) statusPos = 'bottom';
    else if (fitsIn(status, down, ch)) statusPos = 'right';
  }
  return { titlePos, statusPos };
}
