import { describe, expect, it } from 'vitest';
import { clamp, errorText, plural } from './util';

describe('util', () => {
  it('counts with the right noun', () => {
    expect(plural(1, 'widget')).toBe('1 widget');
    expect(plural(0, 'widget')).toBe('0 widgets');
    expect(plural(3, 'tab')).toBe('3 tabs');
  });

  it('clamps, and reads any error', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(errorText(new Error('no'))).toBe('no');
    expect(errorText('plain')).toBe('plain');
  });
});
