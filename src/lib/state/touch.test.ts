import { beforeEach, describe, expect, it } from 'vitest';
import { begin, endPointer, HOLD_OFF_MS, isTouched, pulse, resetTouch } from './touch';

let now = 0;
beforeEach(() => {
  now = 1000;
  resetTouch(() => now);
});

describe('touch', () => {
  it('holds a key while its pointer is down, then for the hold-off after release', () => {
    begin('w', 1);
    now += 10_000;
    expect(isTouched('w')).toBe(true);
    endPointer(1);
    expect(isTouched('w')).toBe(true);
    now += HOLD_OFF_MS;
    expect(isTouched('w')).toBe(false);
  });

  it('stays held while any of several pointers is down', () => {
    begin('w', 1);
    begin('w', 2);
    endPointer(1);
    now += HOLD_OFF_MS * 2;
    expect(isTouched('w')).toBe(true);
    endPointer(2);
    now += HOLD_OFF_MS;
    expect(isTouched('w')).toBe(false);
  });

  it('counts a local change (keys, resets) as a short touch', () => {
    pulse('w#3');
    expect(isTouched('w#3')).toBe(true);
    expect(isTouched('w#4')).toBe(false);
    now += HOLD_OFF_MS;
    expect(isTouched('w#3')).toBe(false);
  });
});
