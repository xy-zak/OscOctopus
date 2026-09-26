import { describe, expect, it } from 'vitest';
import { buildRing, capPaths, CELL, ringAngle } from './ring';

describe('buildRing', () => {
  it('lays out fader-pitch segments along a 270° arc, with quarter ticks', () => {
    const ring = buildRing(200, 180, 270)!;
    expect(ring.nSeg).toBeGreaterThan(20);
    expect(ring.segPaths).toHaveLength(ring.nSeg);
    expect(ring.segPaths.every((d) => d.length > 0)).toBe(true); // no segment lost to the grid
    expect(ring.tickPath).not.toBe('');
  });

  it('snaps everything to the pixel grid', () => {
    const ring = buildRing(160, 160, 360)!;
    const nums = ring.segPaths
      .join('')
      .match(/-?\d+(\.\d+)?/g)!
      .map(Number);
    expect(nums.every((n) => Number.isInteger(n) && n % CELL === 0)).toBe(true);
    expect(ring.tickPath).toBe(''); // the endless ring has no scale
  });

  it('is too small to draw below a few cells', () => {
    expect(buildRing(20, 20, 270)).toBeNull();
  });
});

describe('capPaths', () => {
  it('draws the cap where the value is', () => {
    const ring = buildRing(200, 200, 270)!;
    const centre = (t: number) => {
      const cells = ring.cells.filter((c) => {
        let da = Math.abs(c.a - ringAngle(270, t));
        if (da > Math.PI) da = 2 * Math.PI - da;
        return da * c.r <= 1.6;
      });
      return cells.length;
    };
    for (const t of [0, 0.5, 1]) {
      expect(centre(t)).toBeGreaterThan(3);
      expect(capPaths(ring, t).cap).not.toBe('');
      expect(capPaths(ring, t).outline).not.toBe('');
    }
    // At the top of a 270° ring the cap is a vertical bar above the centre.
    const top = ringAngle(270, 0.5);
    expect(top).toBeCloseTo(0);
  });
});
