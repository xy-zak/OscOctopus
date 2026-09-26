// The v6 value model: records, lists, note events, placeholders and the new argument types.
import { describe, expect, it } from 'vitest';
import { newWidget } from '../model/factory';
import type { ArgTemplate, Widget } from '../model/preset';
import {
  buildArgs,
  buildMessages,
  channelValue,
  fillAddress,
  formatArg,
  initialValue,
  listValue,
  mergeDeltas,
  padEvent,
  typetags,
} from './mapping';

const val = (
  type: Extract<ArgTemplate, { kind: 'value' }>['type'],
  channel?: string,
): ArgTemplate => (channel ? { kind: 'value', type, channel } : { kind: 'value', type });

describe('channelValue', () => {
  it('picks record channels, falling back to `value`, then the first key', () => {
    expect(channelValue({ x: 1, y: 2 }, 'y')).toBe(2);
    expect(channelValue({ x: 1, y: 2 }, undefined)).toBe(1);
    expect(channelValue({ index: 2, value: 'b' }, undefined)).toBe('b');
    expect(channelValue({ x: 1 }, 'nope')).toBeUndefined();
  });
  it('indexes lists by number and returns the whole list otherwise', () => {
    expect(channelValue([1, 'a', true], '1')).toBe('a');
    expect(channelValue([1, 2], undefined)).toEqual([1, 2]);
    expect(channelValue([1, 2], 'x')).toEqual([1, 2]);
  });
  it('scalars ignore the channel', () => {
    expect(channelValue(0.5, 'x')).toBe(0.5);
  });
});

describe('buildArgs', () => {
  it('auto follows the value type', () => {
    expect(buildArgs(val('auto'), 0.5)).toEqual([{ type: 'f', value: 0.5 }]);
    expect(buildArgs(val('auto'), 'go')).toEqual([{ type: 's', value: 'go' }]);
    expect(buildArgs(val('auto'), true)).toEqual([{ type: 'T' }]);
    expect(buildArgs(val('auto', 'missing'), { a: 1 })).toEqual([{ type: 'N' }]);
    expect(buildArgs(val('auto'), [1, 'x'])).toEqual([
      {
        type: '[',
        value: [
          { type: 'f', value: 1 },
          { type: 's', value: 'x' },
        ],
      },
    ]);
  });
  it('[] wraps in an OSC array; ... spreads into separate arguments', () => {
    expect(buildArgs(val('[]'), 3)).toEqual([{ type: '[', value: [{ type: 'f', value: 3 }] }]);
    expect(buildArgs(val('...'), [1, 'a', false])).toEqual([
      { type: 'f', value: 1 },
      { type: 's', value: 'a' },
      { type: 'F' },
    ]);
    expect(buildArgs(val('...'), 7)).toEqual([{ type: 'f', value: 7 }]);
  });
  it('strings coerce sensibly into numeric and bool types', () => {
    expect(buildArgs(val('i'), '42')).toEqual([{ type: 'i', value: 42 }]);
    expect(buildArgs(val('f'), 'nan?')).toEqual([{ type: 'f', value: 0 }]);
    expect(buildArgs(val('TF'), 'false')).toEqual([{ type: 'F' }]);
    expect(buildArgs(val('s'), 0.1 + 0.2)).toEqual([{ type: 's', value: '0.3' }]);
  });
  it('m turns a note event into MIDI bytes: note on/off on the right channel', () => {
    const on = { note: 42, velocity: 1, channel: 2, on: true };
    expect(buildArgs(val('m'), on)).toEqual([{ type: 'm', value: [0, 0x91, 42, 127] }]);
    const off = { ...on, on: false, velocity: 0 };
    expect(buildArgs(val('m'), off)).toEqual([{ type: 'm', value: [0, 0x81, 42, 0] }]);
    expect(buildArgs(val('m'), 0.5)).toEqual([{ type: 'N' }]);
    expect(formatArg({ type: 'm', value: [0, 0x91, 42, 127] })).toBe('midi(00 91 2a 7f)');
  });
});

describe('fillAddress', () => {
  it('fills placeholders from channels and leaves unknown ones as written', () => {
    const e = padEvent({ cols: 4 }, 2, 3, true);
    expect(fillAddress('/grid/{row}/{col}', e)).toBe('/grid/2/3');
    expect(fillAddress('/pad/{number}/{nope}', e)).toBe('/pad/7/{nope}');
    expect(fillAddress('/scene/{label}', listValue([{ label: 'Big Room', value: 'x' }], 0))).toBe(
      '/scene/Big_Room',
    );
    expect(fillAddress('/plain', 1)).toBe('/plain');
  });
});

describe('padEvent / listValue', () => {
  it('numbers pads 1…N in reading order from the top-left', () => {
    const p = { cols: 4 };
    expect(padEvent(p, 1, 1, true)).toEqual({ number: 1, row: 1, col: 1, on: true });
    expect(padEvent(p, 1, 4, false).number).toBe(4);
    expect(padEvent(p, 2, 1, true).number).toBe(5);
    expect(padEvent(p, 4, 4, true).number).toBe(16);
  });
  it('list values become numbers only when they look numeric', () => {
    const opts = [
      { label: 'A', value: '2.5' },
      { label: 'B', value: 'scene-b' },
      { label: 'C', value: ' ' },
    ];
    expect(listValue(opts, 0)).toEqual({ index: 0, label: 'A', value: 2.5 });
    expect(listValue(opts, 1).value).toBe('scene-b');
    expect(listValue(opts, 2).value).toBe(' ');
  });
});

describe('initialValue for the new widgets', () => {
  it('knob, pads and list start from their defaults', () => {
    const knob = newWidget('knob', { x: 0, y: 0, w: 2, h: 2 }, ['out']) as Extract<
      Widget,
      { type: 'knob' }
    >;
    expect(initialValue(knob)).toBe(knob.props.defaultValue);
    knob.props.mode = 'endless';
    expect(initialValue(knob)).toEqual({ value: knob.props.defaultValue, delta: 0 });
    const pads = newWidget('pads', { x: 0, y: 0, w: 2, h: 2 }, ['out']);
    expect(initialValue(pads)).toEqual({ number: 1, row: 1, col: 1, on: false });
    const list = newWidget('list', { x: 0, y: 0, w: 2, h: 2 }, ['out']) as Extract<
      Widget,
      { type: 'list' }
    >;
    list.props.defaultIndex = 1;
    expect(initialValue(list)).toMatchObject({ index: 1, label: list.props.options[1]!.label });
  });

  it('a default pads binding sends the pad number and on/off', () => {
    const pads = newWidget('pads', { x: 0, y: 0, w: 2, h: 2 }, ['out']);
    const [m] = buildMessages(pads, padEvent({ cols: 4 }, 2, 2, true));
    expect(m!.message.address).toBe('/octopus/pads/1');
    expect(typetags(m!.message.args)).toBe(',ii');
    expect(m!.message.args).toEqual([
      { type: 'i', value: 6 },
      { type: 'i', value: 1 },
    ]);
  });
});

describe('mergeDeltas', () => {
  it('adds up held-back encoder deltas and keeps the newest value', () => {
    expect(mergeDeltas({ value: 1, delta: 1 }, { value: 2, delta: 1 })).toEqual({
      value: 2,
      delta: 2,
    });
    expect(mergeDeltas({ value: 1, delta: 0.1 }, { value: 1.2, delta: 0.2 })).toEqual({
      value: 1.2,
      delta: 0.3,
    });
    expect(mergeDeltas(0.2, 0.4)).toBe(0.4);
  });
});
