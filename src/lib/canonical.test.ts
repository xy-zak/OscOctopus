import { describe, expect, it } from 'vitest';
import { canonical } from './canonical';

describe('canonical JSON', () => {
  it('gives one text per meaning', () => {
    expect(canonical({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
    expect(canonical({ a: 1, b: undefined })).toBe(canonical({ a: 1 }));
    expect(canonical(-0)).toBe(canonical(0));
    expect(canonical(Number.NaN)).toBe('null');
    expect(canonical(undefined)).toBe('null');
  });

  it('tells different values apart', () => {
    expect(canonical({ a: 1 })).not.toBe(canonical({ a: '1' }));
    expect(canonical([1, 2])).not.toBe(canonical([2, 1]));
    expect(canonical(null)).not.toBe(canonical({}));
  });
});
