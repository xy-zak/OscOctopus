// Every widget type's def must agree with the schema and with itself: what a new widget
// sends, the value it starts with and the channels it offers.
import { describe, expect, it } from 'vitest';
import { WidgetSchema } from '../model/preset';
import { isRecord } from '../osc/value';
import { channelsFor, DEFS, gateFor, initialValue, newWidget, WIDGET_TYPES } from './defs';

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
    expect(w.bindings.length).toBeGreaterThan(0);
    expect(w.bindings.every((b) => b.outputIds.includes('out-1'))).toBe(true);
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

  it('discrete widgets queue, continuous ones throttle, the endless knob merges', () => {
    const kinds = Object.fromEntries(
      WIDGET_TYPES.map((t) => [t, gateFor(newWidget(t, rect, [])).kind]),
    );
    expect(kinds).toEqual({
      button: 'queue',
      switch: 'queue',
      slider: 'throttle',
      knob: 'throttle',
      graph: 'throttle',
      pads: 'queue',
      list: 'queue',
    });
    const knob = newWidget('knob', rect, []);
    knob.props.mode = 'endless';
    expect(gateFor(knob)).toEqual({ kind: 'merge', maxHz: knob.props.maxRateHz });
    expect(initialValue(knob)).toEqual({ value: knob.props.defaultValue, delta: 0 });
    expect(channelsFor(knob).map((c) => c.id)).toEqual(['value', 'delta']);
  });
});
