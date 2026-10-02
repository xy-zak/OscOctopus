import { describe, expect, it } from 'vitest';
import type { OscArg } from '../ipc/types';
import type { ArgTemplate, Binding, Widget } from '../model/preset';
import { initialValue, inputValue, messagesOf, newWidget, WIDGET_TYPES } from '../widgets/defs';
import { nearestOnOff, rangeTolerance, toBoolean, toNumber } from './coerce';
import {
  compileAddress,
  decodePatch,
  forwardProblem,
  matchAddress,
  oscPattern,
  receiveProblem,
  wireFingerprint,
} from './input';
import { buildMessages } from './mapping';
import { isRecord, type WidgetValue } from './value';

const rect = { x: 0, y: 0, w: 2, h: 2 };
const receiving = (b: Binding): Binding => ({ ...b, receive: true, sourceIds: ['in'] });

describe('compileAddress / matchAddress', () => {
  it('matches literal addresses exactly', () => {
    const c = compileAddress('/mixer/fader/1');
    expect(c.kind).toBe('literal');
    expect(matchAddress(c, '/mixer/fader/1')).toEqual({});
    expect(matchAddress(c, '/mixer/fader/12')).toBeNull();
  });

  it('captures placeholders within one segment', () => {
    const c = compileAddress('/grid/{row}/{col}');
    expect(matchAddress(c, '/grid/2/3')).toEqual({ row: '2', col: '3' });
    expect(matchAddress(c, '/grid/2/3/x')).toBeNull();
    expect(matchAddress(c, '/grid//3')).toBeNull();
    expect(matchAddress(compileAddress('/pad{number}/on'), '/pad12/on')).toEqual({ number: '12' });
    expect(matchAddress(compileAddress('/x/{row}_{col}'), '/x/1_2')).toEqual({
      row: '1',
      col: '2',
    });
  });

  it('rejects addresses that cannot be received unambiguously', () => {
    for (const bad of [
      'no-slash',
      '/has space',
      '/w/*',
      '/w/[0-9]',
      '/a/{x}{y}',
      '/a/{x}/{x}',
      '/a/{x',
      '/a/{a,b}',
    ]) {
      expect(compileAddress(bad).kind, bad).toBe('invalid');
    }
  });
});

describe('oscPattern (incoming wildcard addresses)', () => {
  const matches = (pattern: string, address: string) => oscPattern(pattern)!.test(address);
  it('implements * ? [..] [!..] {a,b}, never crossing /', () => {
    expect(matches('/fader/*', '/fader/1')).toBe(true);
    expect(matches('/fader/*', '/fader/1/x')).toBe(false);
    expect(matches('/ch/?', '/ch/7')).toBe(true);
    expect(matches('/ch/?', '/ch/12')).toBe(false);
    expect(matches('/ch/[0-9]', '/ch/5')).toBe(true);
    expect(matches('/ch/[0-9]', '/ch/12'), 'one character, not one or more').toBe(false);
    expect(matches('/a/[!x]', '/a/b')).toBe(true);
    expect(matches('/a/[!x]', '/a/x')).toBe(false);
    expect(matches('/a/[!x]', '/a//'), 'a negated class never matches /').toBe(false);
    expect(matches('/pads/{1,2}', '/pads/2')).toBe(true);
    expect(matches('/pads/{1,2}', '/pads/3')).toBe(false);
  });
  it('returns null for malformed patterns', () => {
    expect(oscPattern('/a/[0-9')).toBeNull();
    expect(oscPattern('/a/{x,y')).toBeNull();
  });
});

describe('decodePatch (templates in reverse)', () => {
  const slider = newWidget('slider', rect, []);
  const pads = newWidget('pads', rect, []);
  const bind = (args: ArgTemplate[], address = '/x'): Binding => ({
    ...receiving(slider.bindings[0]!),
    address,
    args,
  });

  it('sets channels from arguments by position, whatever numeric type was sent', () => {
    const b = bind([{ kind: 'value', type: 'f' }]);
    expect(decodePatch(slider, b, [{ type: 'i', value: 3 }], {})).toEqual({ value: 3 });
    expect(decodePatch(slider, b, [{ type: 'T' }], {})).toEqual({ value: true });
    expect(decodePatch(slider, b, [], {}), 'missing value: left out').toEqual({});
  });

  it('uses const templates as filters', () => {
    const b = bind([
      { kind: 'const', type: 's', value: 'fader' },
      { kind: 'const', type: 'f', value: '0.1' },
      { kind: 'value', type: 'f' },
    ]);
    const args = (s: string, f: number): OscArg[] => [
      { type: 's', value: s },
      { type: 'f', value: Math.fround(f) },
      { type: 'f', value: 0.5 },
    ];
    expect(decodePatch(slider, b, args('fader', 0.1), {})).toEqual({ value: 0.5 });
    expect(decodePatch(slider, b, args('knob', 0.1), {})).toBeNull();
    expect(decodePatch(slider, b, args('fader', 0.2), {})).toBeNull();
    expect(decodePatch(slider, b, [{ type: 's', value: 'fader' }], {}), 'missing const').toBeNull();
  });

  it('merges address captures with channel arguments (arguments win)', () => {
    const b: Binding = {
      ...receiving(pads.bindings[0]!),
      address: '/pad/{number}',
      args: [{ kind: 'value', type: 'i', channel: 'on' }],
    };
    expect(decodePatch(pads, b, [{ type: 'i', value: 1 }], { number: '7' })).toEqual({
      number: '7',
      on: 1,
    });
  });

  it('gathers the rest for `...`, reads text for `s`, and arrays for `[]`', () => {
    expect(
      decodePatch(
        slider,
        bind([{ kind: 'value', type: '...' }]),
        [
          { type: 'i', value: 1 },
          { type: 's', value: 'a' },
        ],
        {},
      ),
    ).toEqual({ value: [1, 'a'] });
    expect(
      decodePatch(slider, bind([{ kind: 'value', type: 's' }]), [{ type: 'f', value: 2 }], {}),
    ).toEqual({ value: '2' });
    expect(
      decodePatch(
        slider,
        bind([{ kind: 'value', type: '[]' }]),
        [{ type: '[', value: [{ type: 'i', value: 4 }] }],
        {},
      ),
    ).toEqual({ value: [4] });
  });
});

describe('coercion', () => {
  it('reads numbers, booleans and on/off words leniently', () => {
    expect(toNumber('0.5')).toBe(0.5);
    expect(toNumber(true)).toBe(1);
    expect(toNumber('x')).toBeUndefined();
    expect(toBoolean('On')).toBe(true);
    expect(toBoolean(0)).toBe(false);
    expect(toBoolean('maybe')).toBeUndefined();
  });
  it('picks the nearer of on/off, and nothing when they are equal', () => {
    expect(nearestOnOff(0.99999, 1, 0)).toBe(1);
    expect(nearestOnOff(0.2, 1, 0)).toBe(0);
    expect(nearestOnOff('off', 127, 0)).toBe(0);
    expect(nearestOnOff(1, 5, 5)).toBeUndefined();
  });
  it('allows half a step (or 0.1% of the range) of echo drift', () => {
    expect(rangeTolerance({ min: 0, max: 10, step: 1 })).toBe(0.5);
    expect(rangeTolerance({ min: 0, max: 1, step: 0 })).toBeCloseTo(0.001);
  });
});

describe('what a binding may do', () => {
  it('explains why a binding cannot receive', () => {
    const s = newWidget('switch', rect, []);
    const b = receiving(s.bindings[0]!);
    expect(receiveProblem(s, b)).toBeNull();
    expect(receiveProblem(s, { ...b, sourceIds: [] })).toMatch(/where to listen/);
    expect(receiveProblem(s, { ...b, address: '/a/*' })).toMatch(/send-only/);
    expect(receiveProblem({ ...s, props: { onValue: 1, offValue: 1 } }, b)).toMatch(/same/);
    expect(receiveProblem(s, { ...b, args: [{ kind: 'value', type: 'm' }] })).toMatch(/MIDI/);
  });
  it('follows what a widget’s messages may do, whatever its bindings say', () => {
    const text = newWidget('text', rect, []);
    const b = receiving({ ...text.bindings[0]!, forward: true, send: true });
    expect(receiveProblem(text, b)).toMatch(/no messages/);
    text.props.mode = 'osc';
    expect(receiveProblem(text, b)).toBeNull();
    expect(forwardProblem(text)).toMatch(/only shows/);
    const seq = newWidget('sequencer', rect, ['out']);
    expect(receiveProblem(seq, b)).toMatch(/no messages/);
  });
  it('never forwards armed buttons', () => {
    const btn = newWidget('button', rect, []);
    expect(forwardProblem(btn)).toBeNull();
    expect(forwardProblem({ ...btn, props: { ...btn.props, arm: 'double' } })).toMatch(/armed/);
  });
  it('compares what goes on the wire, at float32 precision', () => {
    const s = newWidget('slider', rect, ['out']);
    expect(wireFingerprint(s, 0.1)).toBe(wireFingerprint(s, Math.fround(0.1)));
    expect(wireFingerprint(s, 0.1)).not.toBe(wireFingerprint(s, 0.2));
  });
});

// ---- the inverse property ------------------------------------------------------------------

/** A value of each widget type worth sending, on an otherwise default widget. */
function sample(type: Widget['type']): { widget: Widget; value: WidgetValue } {
  const widget = newWidget(type, rect, ['out']);
  switch (widget.type) {
    case 'slider':
      return { widget, value: 0.3 };
    case 'graph':
      return { widget, value: { x: 0.2, y: 0.8 } };
    case 'button':
    case 'switch':
      return { widget, value: widget.props.onValue };
    case 'pads':
      return { widget, value: { number: 6, row: 2, col: 2, on: true } };
    case 'list':
      return { widget, value: { index: 1, label: 'Two', value: 2 } };
    // They never send (see below).
    case 'sequencer':
    case 'text':
    case 'log':
    case 'subdesk':
      return { widget, value: initialValue(widget) };
  }
}

function close(a: WidgetValue, b: WidgetValue): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-6;
  if (isRecord(a) && isRecord(b)) {
    return (
      Object.keys(a).length === Object.keys(b).length &&
      Object.keys(a).every((k) => close(a[k] as WidgetValue, b[k] as WidgetValue))
    );
  }
  return a === b;
}

describe('send → receive is the identity, for every widget type that sends', () => {
  const sending = WIDGET_TYPES.filter((t) => messagesOf(newWidget(t, rect, [])) === 'full');
  it.each(sending)('%s', (type) => {
    const { widget, value } = sample(type);
    let current = initialValue(widget);
    for (const { bindingId, message } of buildMessages(widget, value)) {
      const binding = receiving(widget.bindings.find((b) => b.id === bindingId)!);
      const captures = matchAddress(compileAddress(binding.address), message.address);
      expect(captures, `address ${message.address} matches ${binding.address}`).not.toBeNull();
      // What arrives is float32, exactly as encoded on the wire.
      const args = message.args.map((a) =>
        a.type === 'f' ? { ...a, value: Math.fround(a.value) } : a,
      );
      const patch = decodePatch(widget, binding, args, captures!);
      expect(patch).not.toBeNull();
      const next = inputValue(widget, patch!, current);
      expect(next).not.toBeNull();
      current = next!;
    }
    expect(close(current, value), `${JSON.stringify(current)} ≈ ${JSON.stringify(value)}`).toBe(
      true,
    );
  });
});
