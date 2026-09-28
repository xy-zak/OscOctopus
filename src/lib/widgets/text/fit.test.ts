import { describe, expect, it } from 'vitest';
import { largestFitting } from './fit';

/** A measure that fits up to `limit`, counting how often it was asked. */
function upTo(limit: number) {
  const asked: number[] = [];
  const fits = (n: number) => {
    asked.push(n);
    return n <= limit;
  };
  return { fits, asked };
}

describe('text fitting', () => {
  it('finds the largest size that fits', () => {
    for (const limit of [10, 11, 17, 39, 40]) {
      expect(largestFitting(10, 40, upTo(limit).fits)).toEqual({ n: limit, fits: true });
    }
  });

  it('says when nothing fits, answering the smallest', () => {
    expect(largestFitting(10, 40, upTo(9).fits)).toEqual({ n: 10, fits: false });
    expect(largestFitting(1, 0, upTo(0).fits)).toEqual({ n: 1, fits: false });
  });

  it('settles on the last answer in two measurements when it still holds', () => {
    const m = upTo(20);
    expect(largestFitting(10, 240, m.fits, 20)).toEqual({ n: 20, fits: true });
    expect(m.asked).toEqual([20, 21]);
  });

  it('searches from the last answer when the text grew or shrank', () => {
    expect(largestFitting(10, 240, upTo(14).fits, 20)).toEqual({ n: 14, fits: true });
    expect(largestFitting(10, 240, upTo(90).fits, 20)).toEqual({ n: 90, fits: true });
    // A last answer out of range (the size was changed) is ignored.
    expect(largestFitting(10, 13, upTo(12).fits, 39)).toEqual({ n: 12, fits: true });
  });

  it('measures about log2 of the range', () => {
    const m = upTo(123);
    largestFitting(10, 240, m.fits);
    expect(m.asked.length).toBeLessThanOrEqual(9);
  });
});
