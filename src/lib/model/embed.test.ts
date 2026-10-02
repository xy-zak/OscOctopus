import { describe, expect, it } from 'vitest';
import { newWidget } from '../widgets/defs';
import { EmbedError, planEmbed, routeTo, sameInput, sameOutput, sends, sendsTo } from './embed';
import { newInput, newOutput, newPreset } from './factory';
import type { Preset, SubdeskWidget } from './preset';

const at = { x: 0, y: 0, w: 1, h: 1 };
const slot = { widget: 'w-host-sub', page: 'pg-host' };

/** A small desk: a fader sending to its output, a button listening on its input. */
function small(): Preset {
  const desk = newPreset('Small');
  desk.network.outputs = [
    newOutput({ id: 'out-small', name: 'Mixer', host: '10.0.0.9', port: 10023 }),
  ];
  desk.network.inputs = [newInput({ id: 'in-small', name: 'Feedback', port: 9001 })];
  const fader = newWidget('slider', at, ['out-small']);
  const button = newWidget('button', { ...at, x: 1 }, ['out-small']);
  button.bindings[0]!.receive = true;
  button.bindings[0]!.sourceIds = ['in-small', 'out-small'];
  desk.widgets = [fader, button];
  return desk;
}

/** A big desk with its own output and input elsewhere. */
function big(): Preset {
  const desk = newPreset('Big');
  desk.network.outputs = [
    newOutput({ id: 'out-big', name: 'Stage', host: '10.0.0.1', port: 9000 }),
  ];
  desk.network.inputs = [newInput({ id: 'in-big', name: 'Remote', port: 8000 })];
  return desk;
}

describe('which endpoints are the same', () => {
  it('outputs: the same target and settings, whatever their names or switches', () => {
    const a = newOutput({ host: '10.0.0.9', port: 10023 });
    expect(sameOutput(a, { ...a, id: 'x', name: 'Other', enabled: false })).toBe(true);
    expect(sameOutput(a, { ...a, port: 10024 })).toBe(false);
  });
  it('inputs: the same socket', () => {
    const a = newInput({ port: 9001 });
    expect(sameInput(a, { ...a, id: 'x', name: 'Other' })).toBe(true);
    expect(sameInput(a, { ...a, port: 9002 })).toBe(false);
    // Framing only matters over TCP.
    expect(sameInput(a, { ...a, framing: 'lengthPrefix' })).toBe(true);
    const t = { ...a, transport: 'tcp' as const };
    expect(sameInput(t, { ...t, framing: t.framing === 'slip' ? 'lengthPrefix' : 'slip' })).toBe(
      false,
    );
  });
});

describe('copying a desk onto a page', () => {
  it('uses the big desk’s first output and input where none is the same', () => {
    const host = big();
    const plan = planEmbed(host, small(), slot, 1);
    const [fader, button] = plan.widgets;
    expect(fader!.bindings[0]!.outputIds).toEqual(['out-big']);
    expect(button!.bindings[0]!.sourceIds).toEqual(['in-big', 'out-big']);
    expect(plan.routes.map((r) => [r.from.id, r.to?.id, r.same])).toEqual([
      ['out-small', 'out-big', false],
      ['in-small', 'in-big', false],
    ]);
    expect(plan.silenced).toEqual([]);
    expect(host.network.outputs.map((o) => o.id)).toEqual(['out-big']);
  });

  it('uses the big desk’s own endpoint where it is the same one', () => {
    const host = big();
    const source = small();
    host.network.outputs.push({ ...source.network.outputs[0]!, id: 'out-same', name: 'Desk' });
    const plan = planEmbed(host, source, slot, 1);
    expect(plan.widgets[0]!.bindings[0]!.outputIds).toEqual(['out-same']);
    expect(plan.routes[0]).toMatchObject({ to: { id: 'out-same' }, same: true });
  });

  it('leaves messages going nowhere when the big desk has no endpoints, and says which', () => {
    const host = big();
    host.network = { outputs: [], inputs: [] };
    const plan = planEmbed(host, small(), slot, 1);
    expect(plan.widgets.flatMap((w) => w.bindings.flatMap((b) => b.outputIds))).toEqual([]);
    expect(plan.silenced).toHaveLength(2);
    expect(plan.routes.every((r) => r.to === null)).toBe(true);
  });

  it('repoints sequences, drops what pointed nowhere, and never repeats an endpoint', () => {
    const source = small();
    const seq = newWidget('sequencer', { ...at, x: 2 }, ['out-small', 'out-gone']);
    const b = source.widgets[1]!.bindings[0]!;
    b.outputIds = ['out-small', 'out-gone'];
    source.widgets.push(seq);
    const plan = planEmbed(big(), source, slot, 1);
    const copy = plan.widgets.find((w) => w.type === 'sequencer');
    expect(copy?.type === 'sequencer' && copy.props.outputIds).toEqual(['out-big']);
    expect(plan.widgets[1]!.bindings[0]!.outputIds).toEqual(['out-big']);
  });

  it('gives every copy a fresh id, and puts the small desk’s own widgets on the page', () => {
    const source = small();
    const monitor = newWidget('text', { ...at, x: 3 }, []);
    monitor.props = { ...monitor.props, mode: 'monitor', target: source.widgets[0]!.id };
    source.widgets.push(monitor);
    const plan = planEmbed(big(), source, slot, 1);
    const ids = new Set(source.widgets.map((w) => w.id));
    expect(plan.widgets.some((w) => ids.has(w.id))).toBe(false);
    expect(plan.widgets.every((w) => w.parent?.widget === slot.widget)).toBe(true);
    const copy = plan.widgets.find((w) => w.type === 'text');
    expect(copy?.type === 'text' && copy.props.target).toBe(plan.widgets[0]!.id);
    expect(plan.grid).toEqual(source.grid);
  });

  it('keeps the small desk’s own sub-desks, and refuses to nest too deep', () => {
    const source = small();
    const inner: SubdeskWidget = newWidget('subdesk', { ...at, y: 3 }, []);
    const onInner = newWidget('button', at, [], 9, {
      widget: inner.id,
      page: inner.props.pages[0]!.id,
    });
    source.widgets.push(inner, onInner);
    const plan = planEmbed(big(), source, slot, 1);
    const copyInner = plan.widgets.find((w) => w.type === 'subdesk')!;
    expect(copyInner.parent).toEqual(slot);
    expect(plan.widgets.find((w) => w.label === onInner.label)?.parent?.widget).toBe(copyInner.id);
    // It brings one level of its own: fine on a page two deep, too deep on one three deep.
    expect(() => planEmbed(big(), source, slot, 2)).not.toThrow();
    expect(() => planEmbed(big(), source, slot, 3)).toThrow(EmbedError);
  });
});

describe('a page’s Send to', () => {
  it('tells where its widgets send, and sends them all to one output', () => {
    const plan = planEmbed(big(), small(), slot, 1);
    const seq = newWidget('sequencer', at, ['out-x']);
    const ws = [...plan.widgets, seq];
    expect(sendsTo(ws).sort()).toEqual(['out-big', 'out-x']);
    expect(ws.every(sends)).toBe(true);
    expect(sends(newWidget('text', at, []))).toBe(false);
    expect(sends(newWidget('sequencer', at, []))).toBe(false);
    routeTo(ws, 'out-y');
    expect(sendsTo(ws)).toEqual(['out-y']);
    // Receiving stays as it was.
    expect(ws[1]!.bindings[0]!.sourceIds).toEqual(['in-big', 'out-big']);
  });
});
