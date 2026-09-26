import { describe, expect, it } from 'vitest';
import { fitsIn, orientFor } from './textfit';

const CH = 8; // px per character

describe('text fitting (one font size, labels turn vertical instead of shrinking)', () => {
  it('counts characters plus padding', () => {
    expect(fitsIn('FADER 1', 9 * CH, CH)).toBe(true);
    expect(fitsIn('FADER 1', 9 * CH - 1, CH)).toBe(false);
  });
  it('counts a Nerd Font icon as one character', () => {
    expect(fitsIn('\u{f1de} A', 5 * CH, CH)).toBe(true);
  });
  it('goes vertical in a thin tall box, and nowhere if neither fits', () => {
    expect(orientFor('FADER 1', 200, 40, CH)).toBe('horizontal');
    expect(orientFor('FADER 1', 40, 200, CH)).toBe('vertical');
    expect(orientFor('FADER 1', 40, 40, CH)).toBe('none');
  });
});
