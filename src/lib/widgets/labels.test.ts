import { describe, expect, it } from 'vitest';
import { labelLayout } from './labels';

const CH = 8;

describe('labelLayout', () => {
  it('puts title and value on top when both fit across', () => {
    expect(labelLayout('FADER 1', '0.5', 200, 100, CH)).toEqual({
      titlePos: 'top',
      statusPos: 'top',
    });
  });
  it('moves the value to the bottom when it does not fit beside the title', () => {
    expect(labelLayout('FADER 1', '0.500', 140, 100, CH)).toEqual({
      titlePos: 'top',
      statusPos: 'bottom',
    });
  });
  it('turns text vertical along the side of a narrow, tall widget', () => {
    expect(labelLayout('FADER 1', '0.500', 40, 260, CH)).toEqual({
      titlePos: 'left',
      statusPos: 'right',
    });
  });
  it('truncates a title if a few characters fit, and hides what fits nowhere', () => {
    expect(labelLayout('A RATHER LONG TITLE', '', 80, 30, CH).titlePos).toBe('top');
    expect(labelLayout('A LONG TITLE', '0.500', 30, 30, CH)).toEqual({
      titlePos: 'none',
      statusPos: 'none',
    });
  });
});
