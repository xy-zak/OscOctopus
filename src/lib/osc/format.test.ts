import { describe, expect, it } from 'vitest';
import { displayValue, formatTime, hexDump, summarize } from './format';
import { addressError } from './mapping';

describe('hexDump', () => {
  it('groups by 4 bytes and shows printable ASCII', () => {
    const bytes = [0x2f, 0x61, 0, 0, 0x2c, 0x66, 0, 0, 0x3f, 0x80, 0, 0];
    expect(hexDump(bytes)).toEqual([
      { offset: '0000', hex: '2f 61 00 00  2c 66 00 00  3f 80 00 00', ascii: '/a··,f··?···' },
    ]);
  });
  it('wraps at the given width', () => {
    const lines = hexDump(Array.from({ length: 20 }, (_, i) => i));
    expect(lines).toHaveLength(2);
    expect(lines[1]!.offset).toBe('0010');
  });
});

describe('displayValue', () => {
  it('shows values as people read them, without quotes', () => {
    expect(displayValue(0.5, 2)).toBe('0.50');
    expect(displayValue(3, 2)).toBe('3');
    expect(displayValue('Act 2', 2)).toBe('Act 2');
    expect(displayValue(true, 2)).toBe('true');
    expect(displayValue([1, 2.25, 'a'], 1)).toBe('1 2.3 a');
    expect(displayValue({ x: 0.125, y: 1 }, 1)).toBe('x 0.1 · y 1');
  });
});

describe('formatTime', () => {
  it('keeps microseconds', () => {
    expect(formatTime(1_700_000_000_123_456).micros).toBe('456');
    expect(formatTime(1_700_000_000_123_456).clock).toMatch(/^\d\d:\d\d:\d\d\.123$/);
  });
});

describe('summarize', () => {
  it('summarises messages and bundles', () => {
    const msg = {
      kind: 'message' as const,
      address: '/a',
      typetags: ',fi',
      args: [
        { type: 'f' as const, value: 0.5 },
        { type: 'i' as const, value: 2 },
      ],
    };
    expect(summarize(msg)).toBe('/a ,fi 0.5 2');
    expect(
      summarize({ kind: 'bundle', timetag: { seconds: 0, fractional: 1 }, content: [msg] }),
    ).toBe('#bundle[1] /a ,fi 0.5 2');
  });
});

describe('addressError (mirrors Rust validate_address)', () => {
  it('accepts valid addresses and patterns', () => {
    expect(addressError('/mixer/ch/1/fader')).toBeNull();
    expect(addressError('/ch/*/mute')).toBeNull();
  });
  it('rejects what Rust rejects', () => {
    expect(addressError('mixer')).toMatch(/start/);
    expect(addressError('/a b')).toMatch(/ASCII/);
    expect(addressError('/a#')).toMatch(/reserved/);
  });
});
