import { describe, expect, it } from 'vitest';
import { decimalsFor, doubleTap, DOUBLE_TAP_MS, keyStep } from './interaction';

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

describe('decimalsFor', () => {
  it('shows as many decimals as the step has, and 3 when continuous', () => {
    expect(decimalsFor(5)).toBe(0);
    expect(decimalsFor(0.25)).toBe(2);
    expect(decimalsFor(0.123456)).toBe(4);
    expect(decimalsFor(0)).toBe(3);
  });
});

describe('keyStep', () => {
  it('is one step of the range, or 1% without a step; Shift is 10x', () => {
    expect(keyStep({ min: 0, max: 10, step: 0.5 }, false)).toBeCloseTo(0.05);
    expect(keyStep({ min: 0, max: 10, step: 0.5 }, true)).toBeCloseTo(0.5);
    expect(keyStep({ min: 0, max: 1, step: 0 }, false)).toBeCloseTo(0.01);
    expect(keyStep({ min: 5, max: 5, step: 1 }, false)).toBe(1); // empty range: no divide by 0
  });
});
