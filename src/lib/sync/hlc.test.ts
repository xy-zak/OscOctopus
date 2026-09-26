import { describe, expect, it } from 'vitest';
import { compareStamps, Hlc, MAX_AHEAD_MS } from './hlc';

const A = 'aaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbb';

describe('hybrid logical clock', () => {
  it('never goes backwards, even when the wall clock does', () => {
    let t = 1000;
    const hlc = new Hlc(A, () => t);
    const s1 = hlc.now();
    t = 500; // clock stepped back
    const s2 = hlc.now();
    const s3 = hlc.now();
    expect(compareStamps(s2, s1)).toBeGreaterThan(0);
    expect(compareStamps(s3, s2)).toBeGreaterThan(0);
    expect(s3).toEqual([1000, 2, A]);
  });

  it('follows stamps it observes', () => {
    const t = 1000;
    const hlc = new Hlc(A, () => t);
    expect(hlc.observe([5000, 7, B])).toBe(true);
    expect(compareStamps(hlc.now(), [5000, 7, B])).toBeGreaterThan(0);
  });

  it('refuses stamps from a clock far in the future', () => {
    const hlc = new Hlc(A, () => 1000);
    expect(hlc.observe([1000 + MAX_AHEAD_MS + 1, 0, B])).toBe(false);
    expect(hlc.now()[0]).toBe(1000);
  });

  it('overflows the counter into the next millisecond', () => {
    const hlc = new Hlc(A, () => 1000);
    let last = hlc.now();
    for (let i = 0; i < 70_000; i++) {
      const s = hlc.now();
      expect(compareStamps(s, last)).toBeGreaterThan(0);
      last = s;
    }
    expect(last[0]).toBe(1001);
  });

  it('orders by wall time, counter, then peer', () => {
    expect(compareStamps([1, 0, B], [2, 0, A])).toBeLessThan(0);
    expect(compareStamps([2, 1, A], [2, 0, B])).toBeGreaterThan(0);
    expect(compareStamps([2, 0, A], [2, 0, B])).toBeLessThan(0);
    expect(compareStamps([2, 0, A], [2, 0, A])).toBe(0);
  });
});
