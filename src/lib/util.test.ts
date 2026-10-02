import { describe, expect, it } from 'vitest';
import { clamp, errorText, plural, unique } from './util';

describe('util', () => {
  it('counts with the right noun', () => {
    expect(plural(1, 'widget')).toBe('1 widget');
    expect(plural(0, 'widget')).toBe('0 widgets');
    expect(plural(3, 'page')).toBe('3 pages');
  });

  it('keeps each item once, in its first order', () => {
    expect(unique(['b', 'a', 'b', 'c', 'a'])).toEqual(['b', 'a', 'c']);
    expect(unique(new Set([1, 2]))).toEqual([1, 2]);
  });

  it('clamps, and reads any error', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(errorText(new Error('no'))).toBe('no');
    expect(errorText('plain')).toBe('plain');
  });
});
