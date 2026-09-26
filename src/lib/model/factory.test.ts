import { describe, expect, it } from 'vitest';
import { newWidget, WIDGET_TYPES } from '../widgets/defs';
import { newPreset, withFreshWidgetIds } from './factory';
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
});

describe('newWidget', () => {
  it.each(WIDGET_TYPES)('a new %s validates against the preset schema', (type) => {
    const p = newPreset();
    p.widgets = [newWidget(type, { x: 0, y: 0, w: 2, h: 2 }, [p.network.outputs[0]!.id])];
    const r = PresetSchema.safeParse(p);
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });
});
