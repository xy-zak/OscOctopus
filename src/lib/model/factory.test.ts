import { describe, expect, it } from 'vitest';
import { newWidget, WIDGET_TYPES } from '../widgets/defs';
import { freshCopies, newPreset, withFreshWidgetIds } from './factory';
import { PresetSchema } from './preset';

describe('newPreset', () => {
  it('first-run desk has a loopback output and input; extra desks only the output', () => {
    const first = newPreset();
    expect(first.network.outputs).toHaveLength(1);
    expect(first.network.inputs).toHaveLength(1);
    const extra = newPreset('Desk 2', { loopbackInput: false });
    expect(extra.network.outputs).toHaveLength(1);
    expect(extra.network.inputs).toHaveLength(0);
    expect(PresetSchema.safeParse(extra).success).toBe(true);
  });
});

describe('withFreshWidgetIds', () => {
  it('renews widget and binding ids but keeps endpoints and output references', () => {
    const p = newPreset();
    const q = withFreshWidgetIds(p);
    const ids = (x: typeof p) => x.widgets.map((w) => w.id);
    expect(ids(q).some((id) => ids(p).includes(id))).toBe(false);
    expect(q.widgets[0]!.bindings[0]!.id).not.toBe(p.widgets[0]!.bindings[0]!.id);
    expect(q.network).toEqual(p.network);
    expect(q.widgets[0]!.bindings[0]!.outputIds).toEqual(p.widgets[0]!.bindings[0]!.outputIds);
    expect(p.widgets[0]!.id).toBe(ids(p)[0]); // original untouched
  });

  it('points widgets that follow others at their new ids, and drops the ones not copied', () => {
    const p = newPreset();
    const [a, b] = p.widgets;
    const text = newWidget('text', { x: 0, y: 7, w: 2, h: 1 }, []);
    text.props = { ...text.props, mode: 'monitor', target: a!.id };
    const log = newWidget('log', { x: 2, y: 7, w: 2, h: 1 }, []);
    log.props = { ...log.props, follow: 'chosen', sources: [a!.id, 'w-elsewhere', b!.id] };
    p.widgets.push(text, log);
    const q = withFreshWidgetIds(p);
    const [qa, qb] = q.widgets;
    const qText = q.widgets.find((w) => w.type === 'text');
    const qLog = q.widgets.find((w) => w.type === 'log');
    expect(qText?.type === 'text' && qText.props.target).toBe(qa!.id);
    expect(qLog?.type === 'log' && qLog.props.sources).toEqual([qa!.id, qb!.id]);
  });
});

describe('freshCopies', () => {
  /** A desk with a frame holding a fader and a monitor of a widget outside it. */
  function nested() {
    const p = newPreset();
    const outsider = p.widgets[0]!;
    const frame = newWidget('tabs', { x: 0, y: 6, w: 4, h: 2 }, []);
    const tab = { widget: frame.id, tab: frame.props.tabs[0]!.id };
    const fader = newWidget('slider', { x: 0, y: 0, w: 1, h: 3 }, ['out'], 9, tab);
    const monitor = newWidget('text', { x: 1, y: 0, w: 2, h: 1 }, [], 1, tab);
    monitor.props = { ...monitor.props, mode: 'monitor', target: outsider.id };
    const log = newWidget('log', { x: 3, y: 0, w: 2, h: 1 }, [], 1, tab);
    log.props = { ...log.props, follow: 'chosen', sources: [fader.id, outsider.id] };
    p.widgets.push(frame, fader, monitor, log);
    return { p, outsider, frame, fader, monitor, log };
  }

  it('keeps a whole desk’s frames when its ids are renewed', () => {
    const { p } = nested();
    const q = withFreshWidgetIds(p);
    const qFrame = q.widgets.find((w) => w.type === 'tabs')!;
    const onTab = q.widgets.filter((w) => w.parent);
    expect(onTab).toHaveLength(3);
    expect(onTab.every((w) => w.parent?.widget === qFrame.id)).toBe(true);
    expect(PresetSchema.safeParse(q).success).toBe(true);
  });

  it('copies part of a desk: refs inside follow, refs to `outside` stay, others go', () => {
    const { outsider, frame, fader, monitor, log } = nested();
    const { widgets, ids } = freshCopies([frame, fader, monitor, log], [outsider.id]);
    const [cFrame, cFader, cMonitor, cLog] = widgets;
    expect(ids.get(frame.id)).toBe(cFrame!.id);
    expect(cFrame!.parent).toBeNull(); // where the copy goes is the caller's to say
    expect(cFader!.parent).toEqual({ widget: cFrame!.id, tab: frame.props.tabs[0]!.id });
    expect(cMonitor?.type === 'text' && cMonitor.props.target).toBe(outsider.id);
    expect(cLog?.type === 'log' && cLog.props.sources).toEqual([cFader!.id, outsider.id]);
    // Without saying who stays, a ref to a widget not copied is dropped.
    const alone = freshCopies([monitor]).widgets[0]!;
    expect(alone.type === 'text' && alone.props.target).toBeNull();
    // The originals are untouched.
    expect(fader.parent?.widget).toBe(frame.id);
  });
});

describe('newWidget', () => {
  it.each(WIDGET_TYPES)('a new %s validates against the preset schema', (type) => {
    const p = newPreset();
    p.widgets = [newWidget(type, { x: 0, y: 0, w: 2, h: 2 }, [p.network.outputs[0]!.id])];
    const r = PresetSchema.safeParse(p);
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });
});
