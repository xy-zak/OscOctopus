// patchInPlace on real Svelte state: widgets keep their identity (keyed lists and the
// Inspector's bound widget stay attached), and only what differs is written.
import { describe, expect, it } from 'vitest';
import { canonical } from '../canonical';
import { newPreset } from '../model/factory';
import type { Preset } from '../model/preset';
import { findConflicts } from './conflicts';
import { patchInPlace } from './reconcile';

describe('patchInPlace', () => {
  it('makes the desk equal while keeping widget and endpoint objects', () => {
    const desk = $state(newPreset('Desk')) as Preset;
    const firstWidget = desk.widgets[0]!;
    const output = desk.network.outputs[0]!;
    const next = JSON.parse(JSON.stringify($state.snapshot(desk))) as Preset;
    next.name = 'Renamed';
    next.widgets[0]!.label = 'Level';
    next.widgets[0]!.props = { ...next.widgets[0]!.props, max: 10 } as never;
    next.widgets.pop(); // one widget deleted
    next.widgets.reverse(); // and the rest reordered
    next.network.outputs[0]!.port = 9100;

    patchInPlace(desk, next);

    expect(canonical($state.snapshot(desk))).toBe(canonical(next));
    const kept = desk.widgets.find((w) => w.id === firstWidget.id);
    expect(kept).toBe(firstWidget);
    expect(kept!.label).toBe('Level');
    expect(desk.network.outputs[0]).toBe(output);
  });

  it('writes nothing when nothing differs', () => {
    const desk = $state(newPreset('Desk')) as Preset;
    const widgets = desk.widgets;
    const before = desk.widgets.slice();
    patchInPlace(desk, JSON.parse(JSON.stringify($state.snapshot(desk))) as Preset);
    expect(desk.widgets).toBe(widgets);
    expect(desk.widgets.every((w, i) => w === before[i])).toBe(true);
  });
});

describe('conflicts', () => {
  it('reports overlaps, widgets outside the grid, and missing endpoints', () => {
    const desk = newPreset('Desk');
    expect(findConflicts(desk)).toEqual([]);
    const [a, b, c] = desk.widgets;
    Object.assign(b!, { x: a!.x, y: a!.y });
    c!.x = desk.grid.cols + 2;
    desk.widgets[4]!.bindings[0]!.outputIds = ['gone'];
    const kinds = findConflicts(desk).map((x) => x.kind);
    expect(kinds).toContain('overlap');
    expect(kinds).toContain('outside');
    expect(kinds).toContain('missingEndpoint');
  });
});
