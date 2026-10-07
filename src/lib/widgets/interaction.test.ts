import { describe, expect, it } from 'vitest';
import { doubleTap, DOUBLE_TAP_MS, keyStep, ticks } from './interaction';

describe('doubleTap', () => {
  it('fires on a second press within the window, then starts over', () => {
    let t = 0;
    const tap = doubleTap(() => t);
    expect(tap()).toBe(false);
    t = DOUBLE_TAP_MS - 1;
    expect(tap()).toBe(true);
    t += 10;
    expect(tap()).toBe(false); // a third quick press is a new first press
    t += DOUBLE_TAP_MS;
    expect(tap()).toBe(false); // too slow
  });
});

describe('keyStep', () => {
  it('is 1% of the range, or one unit of the last decimal when bigger; Shift is 10x', () => {
    expect(keyStep({ min: 0, max: 10, decimals: 0 }, false)).toBeCloseTo(0.1);
    expect(keyStep({ min: 0, max: 10, decimals: 0 }, true)).toBeCloseTo(1);
    expect(keyStep({ min: 0, max: 1, decimals: 3 }, false)).toBeCloseTo(0.01);
    expect(keyStep({ min: 5, max: 5, decimals: 0 }, false)).toBe(1); // empty range: no divide by 0
  });
});

describe('ticks', () => {
  it('ticks through a coarse range, not a nearly continuous one', () => {
    expect(ticks({ min: 0, max: 127, decimals: 0 })).toBe(true);
    expect(ticks({ min: 0, max: 1, decimals: 1 })).toBe(true);
    expect(ticks({ min: 0, max: 1, decimals: 3 })).toBe(false);
  });
});
