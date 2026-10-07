import { describe, expect, it } from 'vitest';
import type { Clock } from '../osc/throttle';
import {
  HOVER_MS,
  MOVE_PX,
  placeTip,
  PRESS_MS,
  TipController,
  TOUCH_SHOW_MS,
  type Shown,
  type TipTarget,
} from './tooltip';

function fakeClock() {
  let t = 0;
  let nextId = 1;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  const clock: Clock = {
    now: () => t,
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.push({ at: t + ms, fn, id });
      return id;
    },
    clearTimeout: (id) => {
      timers = timers.filter((x) => x.id !== id);
    },
  };
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      const due = timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers = timers.filter((x) => x !== due);
      t = due.at;
      due.fn();
    }
    t = end;
  };
  return { clock, advance };
}

const box = { left: 10, top: 100, width: 40, height: 20 };
const target = (text: string, longPress = true): TipTarget => ({
  key: {},
  text,
  box: () => box,
  longPress,
});
const mouse = { pointerType: 'mouse', x: 20, y: 110 };
const finger = { pointerType: 'touch', x: 20, y: 110 };

function setup() {
  const { clock, advance } = fakeClock();
  const seen: (Shown | null)[] = [];
  const tips = new TipController((s) => seen.push(s), clock);
  return { tips, advance, seen };
}

describe('TipController: mouse', () => {
  it('shows after a hover delay, and hides on leaving', () => {
    const { tips, advance } = setup();
    const a = target('A');
    tips.hover(a, mouse);
    advance(HOVER_MS - 1);
    expect(tips.shown).toBeNull();
    advance(1);
    expect(tips.shown).toMatchObject({ via: 'hover', at: box });
    expect(tips.shown?.target.text).toBe('A');
    tips.hover(null, mouse);
    expect(tips.shown).toBeNull();
  });
  it('keeps waiting while over the same target, and swaps at once to the next', () => {
    const { tips, advance } = setup();
    const a = target('A');
    tips.hover(a, mouse);
    advance(HOVER_MS / 2);
    tips.hover(a, mouse); // a child of the same target
    advance(HOVER_MS / 2);
    expect(tips.shown?.target).toBe(a);
    const b = target('B');
    tips.hover(b, mouse);
    expect(tips.shown?.target).toBe(b);
  });
  it('never shows for a hover that left early, and hides on a press', () => {
    const { tips, advance } = setup();
    tips.hover(target('A'), mouse);
    advance(HOVER_MS / 2);
    tips.hover(null, mouse);
    advance(HOVER_MS);
    expect(tips.shown).toBeNull();
    tips.hover(target('A'), mouse);
    advance(HOVER_MS);
    tips.down(null, mouse);
    expect(tips.shown).toBeNull();
    expect(tips.up()).toBe(false);
  });
});

describe('TipController: keyboard', () => {
  it('shows on visible focus at once, and hides on blur or Esc', () => {
    const { tips } = setup();
    tips.focus(target('A'), false);
    expect(tips.shown).toBeNull();
    tips.focus(target('A'), true);
    expect(tips.shown?.via).toBe('focus');
    tips.blur();
    expect(tips.shown).toBeNull();
    tips.focus(target('A'), true);
    tips.dismiss();
    expect(tips.shown).toBeNull();
  });
});

describe('TipController: touch', () => {
  it('shows on a long press above the finger, and swallows the click', () => {
    const { tips, advance } = setup();
    tips.hover(target('A'), finger); // touch never hovers
    advance(HOVER_MS);
    expect(tips.shown).toBeNull();
    tips.down(target('A'), finger);
    advance(PRESS_MS);
    expect(tips.shown).toMatchObject({ via: 'touch', at: { left: 20, top: 110 } });
    expect(tips.up()).toBe(true);
    // It stays after lifting the finger, then goes by itself.
    expect(tips.shown).not.toBeNull();
    advance(TOUCH_SHOW_MS);
    expect(tips.shown).toBeNull();
  });
  it('a short tap is a click, and the next touch hides a shown tip', () => {
    const { tips, advance } = setup();
    tips.down(target('A'), finger);
    advance(PRESS_MS - 1);
    expect(tips.up()).toBe(false);
    advance(PRESS_MS);
    expect(tips.shown).toBeNull();
    tips.down(target('A'), finger);
    advance(PRESS_MS);
    tips.up();
    tips.down(null, finger);
    expect(tips.shown).toBeNull();
    expect(tips.up()).toBe(false);
  });
  it('a finger that moves is scrolling or dragging: no tip', () => {
    const { tips, advance } = setup();
    tips.down(target('A'), finger);
    tips.move({ ...finger, x: finger.x + MOVE_PX / 2 });
    tips.move({ ...finger, x: finger.x + MOVE_PX + 1 });
    advance(PRESS_MS);
    expect(tips.shown).toBeNull();
    expect(tips.up()).toBe(false);
  });
  it('a press-and-hold control keeps its long press', () => {
    const { tips, advance } = setup();
    tips.down(target('HOLD', false), finger);
    advance(PRESS_MS);
    expect(tips.shown).toBeNull();
    expect(tips.up()).toBe(false);
  });
});

describe('placeTip', () => {
  const view = { width: 400, height: 300 };
  it('centres above, and goes below when there is no room above', () => {
    expect(placeTip(box, { width: 20, height: 10 }, view)).toEqual({ left: 20, top: 84 });
    expect(placeTip({ ...box, top: 5 }, { width: 20, height: 10 }, view)).toEqual({
      left: 20,
      top: 31,
    });
  });
  it('stays inside the viewport', () => {
    expect(placeTip({ ...box, left: 390 }, { width: 100, height: 10 }, view).left).toBe(296);
    expect(placeTip({ ...box, left: 0 }, { width: 100, height: 10 }, view).left).toBe(4);
  });
});
