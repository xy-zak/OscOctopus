import { describe, expect, it } from 'vitest';
import type { ArgTemplate } from '../model/preset';
import { initialValue, newWidget } from '../widgets/defs';
import { shape, sliderPosition, sliderValue, unshape } from './curves';
import { formatArg, formatValue, typetags } from './format';
import { buildArgs, buildMessages } from './mapping';
import { channelValue, type WidgetValue } from './value';

/** The single argument a template makes (every type but `...` makes exactly one). */
const buildArg = (t: ArgTemplate, v: WidgetValue) => buildArgs(t, v)[0];

describe('curves', () => {
  it.each(['linear', 'exp', 'log'] as const)(
    '%s is monotonic, pinned at 0 and 1, and invertible',
    (c) => {
      expect(shape(0, c)).toBeCloseTo(0);
      expect(shape(1, c)).toBeCloseTo(1);
      let prev = -1;
      for (let n = 0; n <= 1; n += 0.05) {
        const v = shape(n, c);
        expect(v).toBeGreaterThan(prev);
        expect(unshape(v, c)).toBeCloseTo(n, 6);
        prev = v;
      }
    },
  );
  it('exp gives finer control at the bottom', () => {
    expect(shape(0.5, 'exp')).toBeLessThan(0.5);
    expect(shape(0.5, 'log')).toBeGreaterThan(0.5);
  });
});

describe('sliderValue', () => {
  const p = { min: -10, max: 10, step: 0, curve: 'linear' as const };
  it('maps position to range', () => {
    expect(sliderValue(0, p)).toBe(-10);
    expect(sliderValue(0.75, p)).toBe(5);
  });
  it('quantises to step without float noise', () => {
    expect(sliderValue(0.33, { ...p, min: 0, max: 1, step: 0.1 })).toBe(0.3);
    expect(sliderValue(0.5, { ...p, step: 3 })).toBe(-1);
  });
  it('supports inverted ranges', () => {
    expect(sliderValue(1, { ...p, min: 1, max: 0 })).toBe(0);
    expect(sliderPosition(0.25, { min: 1, max: 0, curve: 'linear' })).toBeCloseTo(0.75);
  });
});

describe('buildArg', () => {
  it('converts the value to each type', () => {
    expect(buildArg({ kind: 'value', type: 'f' }, 0.5)).toEqual({ type: 'f', value: 0.5 });
    expect(buildArg({ kind: 'value', type: 'i' }, 2.6)).toEqual({ type: 'i', value: 3 });
    expect(buildArg({ kind: 'value', type: 'TF' }, 0)).toEqual({ type: 'F' });
    expect(buildArg({ kind: 'value', type: 'TF' }, 1)).toEqual({ type: 'T' });
    expect(buildArg({ kind: 'value', type: 's' }, 0.1 + 0.2)).toEqual({ type: 's', value: '0.3' });
  });
  it('clamps ints to int32', () => {
    expect(buildArg({ kind: 'value', type: 'i' }, 1e12)).toEqual({ type: 'i', value: 2147483647 });
  });
  it('parses constants', () => {
    expect(buildArg({ kind: 'const', type: 'i', value: '42' }, 0)).toEqual({
      type: 'i',
      value: 42,
    });
    expect(buildArg({ kind: 'const', type: 's', value: 'go' }, 0)).toEqual({
      type: 's',
      value: 'go',
    });
    expect(buildArg({ kind: 'const', type: 'N', value: '' }, 0)).toEqual({ type: 'N' });
  });
});

describe('buildMessages', () => {
  it('builds one message per sending binding with outputs', () => {
    const w = newWidget('slider', { x: 0, y: 0, w: 1, h: 4 }, ['out-1'], 1);
    const rest = { receive: true, sourceIds: [], forward: false, args: [] };
    w.bindings.push({ id: 'b2', send: false, outputIds: ['out-1'], address: '/off', ...rest });
    w.bindings.push({ id: 'b3', send: true, outputIds: [], address: '/nowhere', ...rest });
    w.bindings[0]!.args.push({ kind: 'const', type: 's', value: 'x' });
    const out = buildMessages(w, 0.25);
    expect(out).toHaveLength(1);
    expect(out[0]!.message).toEqual({
      address: '/octopus/fader/1',
      args: [
        { type: 'f', value: 0.25 },
        { type: 's', value: 'x' },
      ],
    });
    expect(typetags(out[0]!.message.args)).toBe(',fs');
  });
});

describe('formatArg', () => {
  it('formats compactly', () => {
    expect(formatArg({ type: 'f', value: 1 })).toBe('1.0');
    expect(formatArg({ type: 'f', value: 0.30000001192092896 })).toBe('0.3');
    expect(formatArg({ type: 'T' })).toBe('T');
    expect(formatArg({ type: 'r', value: 0xff0000ff })).toBe('#ff0000ff');
  });
});

describe('graph (two channels)', () => {
  const g = newWidget('graph', { x: 0, y: 0, w: 4, h: 4 }, ['out-1'], 1);

  it('defaults to one message per axis', () => {
    const out = buildMessages(g, { x: 0.25, y: 0.75 });
    expect(out.map((m) => m.message)).toEqual([
      { address: '/octopus/graph/1/x', args: [{ type: 'f', value: 0.25 }] },
      { address: '/octopus/graph/1/y', args: [{ type: 'f', value: 0.75 }] },
    ]);
  });

  it('can carry both channels in one message', () => {
    const one = {
      ...g,
      bindings: [
        {
          id: 'xy',
          send: true,
          receive: false,
          sourceIds: [],
          forward: false,
          outputIds: ['out-1'],
          address: '/xy',
          args: [
            { kind: 'value' as const, type: 'f' as const, channel: 'x' as const },
            { kind: 'value' as const, type: 'i' as const, channel: 'y' as const },
          ],
        },
      ],
    };
    expect(buildMessages(one, { x: 0.5, y: 3.4 })[0]!.message.args).toEqual([
      { type: 'f', value: 0.5 },
      { type: 'i', value: 3 },
    ]);
  });

  it('single-value widgets ignore the channel', () => {
    expect(channelValue(0.3, 'y')).toBe(0.3);
    expect(channelValue({ x: 1, y: 2 }, undefined)).toBe(1);
  });

  it('starts at each axis default', () => {
    expect(initialValue(g)).toEqual({ x: 0.5, y: 0.5 });
    expect(formatValue({ x: 0.5, y: 0.123456 })).toBe('x 0.5 · y 0.1235');
  });
});
