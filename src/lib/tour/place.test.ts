// Where the tour's popup goes beside its target.
import { describe, expect, it } from 'vitest';
import { clampBox, placePopup, unionBox } from './place';

const viewport = { width: 1000, height: 800 };
const size = { width: 300, height: 150 };

describe('placePopup', () => {
  it('goes below a target with room under it, centred on it', () => {
    expect(placePopup({ left: 400, top: 100, width: 200, height: 50 }, size, viewport)).toEqual({
      left: 350,
      top: 162,
      side: 'below',
    });
  });

  it('goes above a target near the bottom', () => {
    const at = placePopup({ left: 400, top: 650, width: 200, height: 100 }, size, viewport);
    expect(at).toEqual({ left: 350, top: 488, side: 'above' });
  });

  it('goes right, then left, of a tall target', () => {
    expect(placePopup({ left: 100, top: 20, width: 200, height: 760 }, size, viewport).side).toBe(
      'right',
    );
    expect(placePopup({ left: 600, top: 20, width: 350, height: 760 }, size, viewport)).toEqual({
      left: 288,
      top: 325,
      side: 'left',
    });
  });

  it('sits inside the bottom of a target that fills the screen', () => {
    const at = placePopup({ left: 0, top: 0, width: 1000, height: 800 }, size, viewport);
    expect(at).toEqual({ left: 350, top: 638, side: 'over' });
  });

  it('is centred without a target', () => {
    expect(placePopup(null, size, viewport)).toEqual({ left: 350, top: 325, side: 'centre' });
  });

  it('stays inside the viewport', () => {
    expect(placePopup({ left: 0, top: 100, width: 40, height: 20 }, size, viewport).left).toBe(8);
    expect(placePopup({ left: 980, top: 100, width: 20, height: 20 }, size, viewport).left).toBe(
      692,
    );
  });
});

describe('clampBox', () => {
  it('keeps the part on screen, just inside its edges', () => {
    expect(clampBox({ left: -4, top: 100, width: 1100, height: 2000 }, 1000, 800)).toEqual({
      left: 2,
      top: 100,
      width: 996,
      height: 698,
    });
  });

  it('leaves a box on screen as it is', () => {
    const box = { left: 10, top: 10, width: 100, height: 50 };
    expect(clampBox(box, 1000, 800)).toEqual(box);
  });
});

describe('unionBox', () => {
  it('is the box around all of them', () => {
    expect(
      unionBox([
        { left: 10, top: 20, width: 30, height: 10 },
        { left: 50, top: 5, width: 10, height: 10 },
      ]),
    ).toEqual({ left: 10, top: 5, width: 50, height: 25 });
  });

  it('is null for none', () => {
    expect(unionBox([])).toBeNull();
  });
});
