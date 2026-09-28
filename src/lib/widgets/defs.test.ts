// Every widget type's def must agree with the schema and with itself: what a new widget
// sends, the value it starts with and the channels it offers.
import { describe, expect, it } from 'vitest';
import { LIMITS, WidgetSchema } from '../model/preset';
import { isRecord } from '../osc/value';
import {
  channelsFor,
  DEFS,
  gateFor,
  initialValue,
  inputValue,
  isValueFor,
  messagesOf,
  newWidget,
  WIDGET_TYPES,
} from './defs';

const rect = { x: 0, y: 0, w: 2, h: 2 };

describe('widget defs', () => {
  it('cover exactly the widget types of the schema', () => {
    const schemaTypes = WidgetSchema.options.map((o) => o.shape.type.value);
    expect(new Set(WIDGET_TYPES)).toEqual(new Set(schemaTypes));
  });

  it.each(WIDGET_TYPES)('%s: a new widget is valid, placed, numbered and wired', (type) => {
    const w = newWidget(type, { x: 1, y: 2, ...DEFS[type].defaultSize }, ['out-1'], 3);
    const parsed = WidgetSchema.safeParse(w);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(w).toMatchObject({ type, x: 1, y: 2, color: null });
    expect(w.label).toBe(`${DEFS[type].label} 3`);
    if (messagesOf(w) === 'full') {
      expect(w.bindings.length).toBeGreaterThan(0);
      expect(w.bindings.every((b) => b.outputIds.includes('out-1'))).toBe(true);
    } else {
      expect(w.bindings.every((b) => !b.send)).toBe(true);
    }
  });

  it.each(WIDGET_TYPES)('%s: the initial value has exactly the offered channels', (type) => {
    const w = newWidget(type, rect, []);
    const value = initialValue(w);
    const channels = channelsFor(w).map((c) => c.id);
    if (channels.length === 0) expect(isRecord(value)).toBe(false);
    else expect(isRecord(value) ? Object.keys(value).sort() : value).toEqual(channels.sort());
  });

  it.each(WIDGET_TYPES)('%s: default messages only pick channels the value has', (type) => {
    const w = newWidget(type, rect, []);
    const channels = channelsFor(w).map((c) => c.id);
    for (const arg of w.bindings.flatMap((b) => b.args)) {
      if (arg.kind === 'value' && arg.channel) expect(channels).toContain(arg.channel);
    }
  });

  it('discrete widgets queue, continuous ones throttle', () => {
    const kinds = Object.fromEntries(
      WIDGET_TYPES.map((t) => [t, gateFor(newWidget(t, rect, [])).kind]),
    );
    expect(kinds).toEqual({
      button: 'queue',
      switch: 'queue',
      slider: 'throttle',
      graph: 'throttle',
      pads: 'queue',
      list: 'queue',
      sequencer: 'queue',
      text: 'queue',
      log: 'queue',
    });
  });
});

describe('what received values set (WidgetDef.input)', () => {
  const nothing = {};
  it('switch: the nearer of on/off; buttons fire on a bare message only in trigger mode', () => {
    const sw = newWidget('switch', rect, []);
    sw.props = { onValue: 127, offValue: 0 };
    expect(inputValue(sw, { value: 120 }, 0)).toBe(127);
    expect(inputValue(sw, { value: 'off' }, 127)).toBe(0);
    const btn = newWidget('button', rect, []);
    expect(inputValue(btn, nothing, 0)).toBeNull();
    btn.props.mode = 'trigger';
    expect(inputValue(btn, nothing, 0)).toBe(btn.props.onValue);
  });

  it('pads: by number or by row and column, set (never flipped), and in range only', () => {
    const pads = newWidget('pads', rect, []);
    pads.props.mode = 'toggle';
    expect(inputValue(pads, { row: 2, col: 3, on: 0 }, initialValue(pads))).toEqual({
      number: 7,
      row: 2,
      col: 3,
      on: false,
    });
    expect(inputValue(pads, { number: '5' }, initialValue(pads))).toMatchObject({
      number: 5,
      on: true,
    });
    expect(inputValue(pads, { number: 17 }, initialValue(pads))).toBeNull();
    expect(inputValue(pads, { number: 2.5 }, initialValue(pads))).toBeNull();
  });

  it('list: by index, then value, then label (underscores read as spaces, any case)', () => {
    const list = newWidget('list', rect, []);
    list.props.options = [
      { label: 'Big Room', value: 'scene-a' },
      { label: 'Small', value: '2' },
    ];
    const current = initialValue(list);
    expect(inputValue(list, { index: 1 }, current)).toMatchObject({ index: 1 });
    expect(inputValue(list, { index: 2 }, current)).toBeNull();
    expect(inputValue(list, { value: 2 }, current)).toMatchObject({ index: 1 });
    expect(inputValue(list, { value: 'scene-a' }, current)).toMatchObject({ index: 0 });
    expect(inputValue(list, { label: 'Big_Room' }, current)).toMatchObject({ index: 0 });
    expect(inputValue(list, { label: 'small' }, current)).toMatchObject({ index: 1 });
    expect(inputValue(list, { label: 'nope' }, current)).toBeNull();
  });

  it('graph: sets the axes present, each clamped to its own range', () => {
    const g = newWidget('graph', rect, []);
    expect(inputValue(g, { y: 5 }, { x: 0.25, y: 0.5 })).toEqual({ x: 0.25, y: 1 });
    expect(inputValue(g, {}, { x: 0.25, y: 0.5 })).toBeNull();
  });
});

describe('what a peer may set (WidgetDef.isValue)', () => {
  it('accepts every widget type’s own values', () => {
    for (const type of WIDGET_TYPES) {
      const w = newWidget(type, rect, []);
      expect(isValueFor(w, initialValue(w)), type).toBe(true);
    }
    const pads = newWidget('pads', rect, []);
    expect(isValueFor(pads, inputValue(pads, { number: 5 }, initialValue(pads)))).toBe(true);
    const list = newWidget('list', rect, []);
    expect(isValueFor(list, inputValue(list, { index: 1 }, initialValue(list)))).toBe(true);
  });

  it('text: any scalar it can show; received text is cut to the limit', () => {
    const text = newWidget('text', rect, []);
    expect(inputValue(text, {}, '')).toBeNull();
    expect(inputValue(text, { value: 'Act 2' }, '')).toBe('Act 2');
    expect(inputValue(text, { value: 0.5 }, '')).toBe(0.5);
    expect(inputValue(text, { value: ['a', 1] }, '')).toBe('a 1');
    const long = 'x'.repeat(LIMITS.textChars.max + 10);
    expect(inputValue(text, { value: long }, '')).toHaveLength(LIMITS.textChars.max);
    expect(isValueFor(text, long)).toBe(false);
    expect(isValueFor(text, { forged: 1 })).toBe(false);
  });

  it('sequencer and log: never a peer’s value but their idle one', () => {
    const seq = newWidget('sequencer', rect, []);
    expect(isValueFor(seq, initialValue(seq))).toBe(true);
    expect(isValueFor(seq, { state: 'running', step: 2, pass: 1 })).toBe(false);
    const log = newWidget('log', rect, []);
    expect(isValueFor(log, 1)).toBe(false);
    expect(inputValue(seq, { state: 'running' }, initialValue(seq))).toBeNull();
  });

  it('refuses the wrong shape, out-of-range values and extra fields', () => {
    const slider = newWidget('slider', rect, []);
    expect(isValueFor(slider, 2)).toBe(false);
    expect(isValueFor(slider, '0.5')).toBe(false);
    expect(isValueFor(slider, Number.NaN)).toBe(false);
    const button = newWidget('button', rect, []);
    expect(isValueFor(button, 0.5)).toBe(false);
    const graph = newWidget('graph', rect, []);
    expect(isValueFor(graph, { x: 0.5, y: 0.5 })).toBe(true);
    expect(isValueFor(graph, { x: 0.5, y: 0.5, z: 1 })).toBe(false);
    expect(isValueFor(graph, { x: 0.5 })).toBe(false);
    const pads = newWidget('pads', rect, []);
    expect(isValueFor(pads, { number: 2, row: 1, col: 1, on: true })).toBe(false);
    expect(isValueFor(pads, { number: 99, row: 9, col: 9, on: true })).toBe(false);
    const list = newWidget('list', rect, []);
    expect(isValueFor(list, { index: 0, label: 'forged', value: 1 })).toBe(false);
    expect(isValueFor(list, { index: 99, label: '', value: '' })).toBe(false);
  });
});
