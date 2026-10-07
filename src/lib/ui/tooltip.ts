// When the app's one tooltip shows, for mouse, keyboard and touch alike. Pure: Tooltip.svelte
// feeds it pointer and focus events for elements with a `data-tip`, and draws what it shows.
// Tested in tooltip.test.ts.
//
//   mouse     hover HOVER_MS; moving to another tip while one shows swaps at once; leaving,
//             pressing or scrolling hides it
//   keyboard  focus (when the browser shows focus) shows it at once; blur or Esc hides it
//   touch     a long press (PRESS_MS, moving less than MOVE_PX) shows it above the finger and
//             swallows the click that would follow; the next touch, or TOUCH_SHOW_MS, hides it
//
// A target can refuse the long press (`longPress: false`): a HoldSwitch, whose long press is
// what it does.
import type { Clock } from '../osc/throttle';

export const HOVER_MS = 500;
export const PRESS_MS = 500;
export const MOVE_PX = 8;
export const TOUCH_SHOW_MS = 4000;

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** An element with a tip, as the controller sees it. `key` tells one target from another. */
export interface TipTarget {
  key: object;
  text: string;
  /** Where it is on screen, read when it is shown. */
  box: () => Box;
  /** May a long press show it (no: a press-and-hold control)? */
  longPress: boolean;
}

export type Via = 'hover' | 'focus' | 'touch';

export interface Shown {
  target: TipTarget;
  via: Via;
  /** Where to point: the target, or the finger for a long press. */
  at: Box;
}

export interface PointerInfo {
  pointerType: string;
  x: number;
  y: number;
}

const realClock: Clock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

const isTouch = (p: PointerInfo) => p.pointerType === 'touch' || p.pointerType === 'pen';

export class TipController {
  shown: Shown | null = null;
  private timer: unknown = null;
  /** The target a hover is waiting to show. */
  private pending: TipTarget | null = null;
  private hideTimer: unknown = null;
  /** A long press in progress: where it started and on what. */
  private press: { target: TipTarget; x: number; y: number } | null = null;
  /** The click after a long press that showed a tip is not a click. */
  private swallow = false;

  constructor(
    private readonly onChange: (shown: Shown | null) => void,
    private readonly clock: Clock = realClock,
  ) {}

  /** A mouse came over a target (or over nothing with a tip: `null`). */
  hover(target: TipTarget | null, p: PointerInfo) {
    if (isTouch(p)) return;
    // Still over the same target (pointerover also fires for its children).
    if (target && (target.key === this.shown?.target.key || target.key === this.pending?.key))
      return;
    this.cancel();
    if (!target) {
      if (this.shown?.via === 'hover') this.hide();
      return;
    }
    // Already reading tips: the next one comes at once.
    if (this.shown?.via === 'hover') this.show(target, 'hover', target.box());
    else {
      this.pending = target;
      this.timer = this.clock.setTimeout(() => this.show(target, 'hover', target.box()), HOVER_MS);
    }
  }

  /** The pointer went down, on a target or not. */
  down(target: TipTarget | null, p: PointerInfo) {
    this.cancel();
    this.swallow = false;
    if (this.shown) this.hide();
    if (!isTouch(p) || !target?.longPress) return;
    this.press = { target, x: p.x, y: p.y };
    this.timer = this.clock.setTimeout(() => {
      const at = { left: p.x, top: p.y, width: 0, height: 0 };
      this.press = null;
      this.swallow = true;
      this.show(target, 'touch', at);
      this.hideTimer = this.clock.setTimeout(() => this.hide(), TOUCH_SHOW_MS);
    }, PRESS_MS);
  }

  /** The pointer moved: a finger that moves is scrolling or dragging, not asking. */
  move(p: PointerInfo) {
    if (!this.press) return;
    if (Math.hypot(p.x - this.press.x, p.y - this.press.y) > MOVE_PX) this.cancel();
  }

  /**
   * The pointer came up. True when the click it makes must be swallowed (it ended a long press
   * that showed a tip). The tip itself stays until the next touch or TOUCH_SHOW_MS.
   */
  up(): boolean {
    if (this.press) this.cancel();
    const swallow = this.swallow;
    this.swallow = false;
    return swallow;
  }

  /** Keyboard focus reached a target (`visible`: the browser shows focus, not a click). */
  focus(target: TipTarget | null, visible: boolean) {
    if (!target || !visible) return;
    this.cancel();
    this.show(target, 'focus', target.box());
  }

  blur() {
    if (this.shown?.via === 'focus') this.hide();
  }

  /** Esc, a scroll, the window losing focus: whatever shows goes. */
  dismiss() {
    this.cancel();
    if (this.shown) this.hide();
  }

  private show(target: TipTarget, via: Via, at: Box) {
    this.timer = null;
    this.pending = null;
    this.clock.clearTimeout(this.hideTimer);
    this.shown = { target, via, at };
    this.onChange(this.shown);
  }

  private hide() {
    this.clock.clearTimeout(this.hideTimer);
    this.hideTimer = null;
    this.shown = null;
    this.onChange(null);
  }

  /** Stops whatever was about to show. */
  private cancel() {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
    this.press = null;
  }
}

/**
 * Where a tip of `size` goes for `at`: centred above it, below when there is no room above,
 * kept `margin` inside the viewport.
 */
export function placeTip(
  at: Box,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 6,
  margin = 4,
): { left: number; top: number } {
  const centre = at.left + at.width / 2;
  const left = Math.min(
    Math.max(margin, centre - size.width / 2),
    viewport.width - size.width - margin,
  );
  const above = at.top - gap - size.height;
  const top =
    above >= margin
      ? above
      : Math.min(at.top + at.height + gap, viewport.height - size.height - margin);
  return { left: Math.max(margin, left), top: Math.max(margin, top) };
}
