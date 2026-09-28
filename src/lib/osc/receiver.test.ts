// Input mapping decisions, without Rust or Svelte: routes, then planBatch over fake
// dependencies (a fake clock, no touch unless a test says so).
import { describe, expect, it } from 'vitest';
import type { InboundMessage, OscArg } from '../ipc/types';
import { newPreset } from '../model/factory';
import type { Binding, Preset, Widget } from '../model/preset';
import { initialValue, newWidget } from '../widgets/defs';
import { Breaker } from './breaker';
import { Expectations } from './expect';
import { planBatch, type PlanDeps } from './receiver.svelte';
import { RouteIndex } from './routes';
import type { WidgetValue } from './value';

const rect = { x: 0, y: 0, w: 2, h: 2 };

function desk(widgets: Widget[]): Preset {
  const p = newPreset('Test');
  p.widgets = widgets;
  return p;
}

/** A widget whose first binding receives on input `in`, with changes applied. */
function receiver<W extends Widget>(w: W, change: Partial<Binding> = {}): W {
  w.bindings = [{ ...w.bindings[0]!, receive: true, sourceIds: ['in'], ...change }];
  return w;
}

let seq = 0;
function msg(p: Preset, address: string, args: OscArg[], endpointId = 'in'): InboundMessage {
  return {
    seq: ++seq,
    tsMicros: 0,
    desk: p.id,
    endpointId,
    remote: '192.0.2.9:8000',
    address,
    args,
  };
}
const f = (value: number): OscArg => ({ type: 'f', value });
const i = (value: number): OscArg => ({ type: 'i', value });

function deps(p: Preset, overrides: Partial<PlanDeps> = {}): PlanDeps {
  const values = new Map<string, WidgetValue>();
  return {
    index: new RouteIndex([p]),
    find: (id) => {
      const widget = p.widgets.find((w) => w.id === id);
      return widget && { desk: p, widget };
    },
    current: (w) => values.get(w.id) ?? initialValue(w),
    isTouched: () => false,
    expect: new Expectations(() => 0),
    breaker: new Breaker(),
    now: 0,
    mayForward: () => true,
    ...overrides,
  };
}

describe('RouteIndex', () => {
  it('routes by desk, endpoint and address, and reports what each desk listens on', () => {
    const fader = receiver(newWidget('slider', rect, []), {
      address: '/f/1',
      sourceIds: ['in', 'out'],
    });
    const pads = receiver(newWidget('pads', rect, []), { address: '/pad/{number}' });
    const quiet = newWidget('switch', rect, []);
    const p = desk([fader, pads, quiet]);
    const index = new RouteIndex([p]);
    expect(index.listen.get(p.id)).toEqual(['in', 'out']);
    expect(index.lookup(p.id, 'in', '/f/1').map((m) => m.route.widgetId)).toEqual([fader.id]);
    expect(index.lookup(p.id, 'other', '/f/1')).toEqual([]);
    expect(index.lookup(p.id, 'in', '/pad/3')).toEqual([
      {
        route: { deskId: p.id, widgetId: pads.id, bindingId: pads.bindings[0]!.id },
        captures: { number: '3' },
      },
    ]);
    expect(index.lookup(p.id, 'in', '/switch/1')).toEqual([]);
  });

  it('matches wildcard addresses against literal routes only', () => {
    const a = receiver(newWidget('slider', rect, []), { address: '/f/1' });
    const b = receiver(newWidget('slider', rect, []), { address: '/f/2' });
    const p = desk([a, b]);
    const hits = new RouteIndex([p]).lookup(p.id, 'in', '/f/*');
    expect(hits.map((h) => h.route.widgetId).sort()).toEqual([a.id, b.id].sort());
  });

  it('skips bindings that cannot receive', () => {
    const w = receiver(newWidget('slider', rect, []), { address: '/f/1', sourceIds: [] });
    const p = desk([w]);
    expect(new RouteIndex([p]).listen.size).toBe(0);
  });
});

describe('planBatch', () => {
  it('applies a message to the widget it addresses, clamped by the widget type', () => {
    const fader = receiver(newWidget('slider', rect, []), { address: '/f' });
    const p = desk([fader]);
    const plan = planBatch([msg(p, '/f', [f(2)])], deps(p));
    expect(plan.applies).toMatchObject([{ widget: { id: fader.id }, value: 1, forward: null }]);
    expect([...plan.outcomes.values()].flat()).toEqual([
      { result: 'applied', widget: fader.label },
    ]);
  });

  it('keeps only the newest message per binding for continuous widgets', () => {
    const fader = receiver(newWidget('slider', rect, []), { address: '/f' });
    const p = desk([fader]);
    const plan = planBatch(
      [msg(p, '/f', [f(0.1)]), msg(p, '/f', [f(0.2)]), msg(p, '/f', [f(0.3)])],
      deps(p),
    );
    expect(plan.applies.map((a) => a.value)).toEqual([0.3]);
    expect([...plan.outcomes.values()].flat().map((o) => o.result)).toEqual([
      'coalesced',
      'coalesced',
      'applied',
    ]);
  });

  it('keeps every message of a discrete widget, in order, up to a cap', () => {
    const pads = receiver(newWidget('pads', rect, []), {
      address: '/pad/{number}',
      args: [{ kind: 'value', type: 'i', channel: 'on' }],
    });
    const p = desk([pads]);
    const burst = Array.from({ length: 70 }, (_, n) => msg(p, `/pad/${(n % 16) + 1}`, [i(1)]));
    const plan = planBatch(burst, deps(p));
    expect(plan.applies).toHaveLength(64);
    expect((plan.applies[1]!.value as { number: number }).number).toBe(2);
    expect([...plan.outcomes.values()].flat().filter((o) => o.result === 'dropped')).toHaveLength(
      6,
    );
  });

  it('never moves a widget the local user is touching; pads are touched one by one', () => {
    const fader = receiver(newWidget('slider', rect, []), { address: '/f' });
    const pads = receiver(newWidget('pads', rect, []), { address: '/pad/{number}', args: [] });
    const p = desk([fader, pads]);
    const touched = new Set([fader.id, `${pads.id}#3`]);
    const plan = planBatch(
      [msg(p, '/f', [f(0.5)]), msg(p, '/pad/3', []), msg(p, '/pad/4', [])],
      deps(p, { isTouched: (key) => touched.has(key) }),
    );
    expect(plan.applies.map((a) => (a.value as { number?: number }).number)).toEqual([4]);
    expect([...plan.outcomes.values()].flat().map((o) => o.result)).toEqual([
      'touched',
      'touched',
      'applied',
    ]);
  });

  it('recognises our own sent values coming back (within the widget tolerance)', () => {
    const fader = receiver(newWidget('slider', rect, []), { address: '/f' });
    const p = desk([fader]);
    const expect_ = new Expectations(() => 0);
    expect_.note(fader, 0.123456789);
    const plan = planBatch(
      [msg(p, '/f', [f(Math.fround(0.123456789))])],
      deps(p, { expect: expect_ }),
    );
    expect(plan.applies).toEqual([]);
    expect([...plan.outcomes.values()].flat()[0]!.result).toBe('own echo');
  });

  it('ignores messages whose value means nothing to the widget', () => {
    const list = receiver(newWidget('list', rect, []), { address: '/l' });
    const p = desk([list]);
    const [outOfRange, unknown] = [msg(p, '/l', [i(9)]), msg(p, '/nothing', [])];
    const plan = planBatch([outOfRange, unknown], deps(p));
    expect(plan.applies).toEqual([]);
    expect(plan.outcomes.get(outOfRange.seq)).toEqual([{ result: 'ignored', widget: list.label }]);
    expect(plan.outcomes.get(unknown.seq)).toEqual([{ result: 'no match' }]);
  });

  describe('forwarding', () => {
    const forwarding = () => {
      const sw = receiver(newWidget('switch', rect, ['out']), { forward: true });
      return { sw, p: desk([sw]) };
    };

    it('forwards only when the binding forwards and the wire output changes, never back', () => {
      const { sw, p } = forwarding();
      const m = msg(p, sw.bindings[0]!.address, [i(1)]);
      const plan = planBatch([m], deps(p));
      expect(plan.applies[0]!.forward).toEqual({ endpointId: 'in', remote: '192.0.2.9:8000' });
      // Already on: nothing new to forward.
      const again = planBatch(
        [msg(p, sw.bindings[0]!.address, [i(1)])],
        deps(p, { current: () => 1 }),
      );
      expect(again.applies[0]!.forward).toBeNull();
    });

    it('does not forward where forwarding is not allowed', () => {
      const { sw, p } = forwarding();
      const plan = planBatch(
        [msg(p, sw.bindings[0]!.address, [i(1)])],
        deps(p, { mayForward: () => false }),
      );
      expect(plan.applies[0]!.forward).toBeNull();
      const armed = receiver(newWidget('button', rect, ['out']), { forward: true });
      armed.props.arm = 'hold';
      const q = desk([armed]);
      expect(
        planBatch([msg(q, armed.bindings[0]!.address, [i(1)])], deps(q)).applies[0]!.forward,
      ).toBeNull();
    });

    it('trips the breaker when a discrete widget forwards too often', () => {
      const { sw, p } = forwarding();
      const tripped: string[] = [];
      const breaker = new Breaker((id) => tripped.push(id), 3, 1000);
      let current: WidgetValue = 0;
      const results: string[] = [];
      for (let n = 0; n < 5; n++) {
        const plan = planBatch(
          [msg(p, sw.bindings[0]!.address, [i(n % 2 ? 0 : 1)])],
          deps(p, { breaker, now: n * 10, current: () => current }),
        );
        current = plan.applies[0]!.value;
        results.push([...plan.outcomes.values()].flat()[0]!.result);
      }
      expect(results).toEqual([
        'forwarded',
        'forwarded',
        'forwarded',
        'forward stopped',
        'forward stopped',
      ]);
      expect(tripped).toEqual([sw.id]);
    });
  });
});

describe('Expectations', () => {
  it('acknowledges up to a match, forgets on divergence, and expires', () => {
    let now = 0;
    const exp = new Expectations(() => now);
    const fader = newWidget('slider', rect, []);
    exp.note(fader, 0.1);
    exp.note(fader, 0.2);
    exp.note(fader, 0.3);
    expect(exp.isOwnEcho(fader, 0.2)).toBe(true); // drops 0.1 and 0.2
    expect(exp.isOwnEcho(fader, 0.1)).toBe(false); // gone; and diverged: clears the rest
    expect(exp.isOwnEcho(fader, 0.3)).toBe(false);
    exp.note(fader, 0.5);
    now = 2000;
    expect(exp.isOwnEcho(fader, 0.5), 'expired').toBe(false);
  });
});
