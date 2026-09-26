// The origin rules: a local touch is shown, sent and shared; matched input is shown and shared,
// and only sent when forwarded (with where it must not go back to).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalValueChange } from '../state/changes';
import { newPreset } from '../model/factory';

const desk = newPreset('Flow');
const sent: unknown[][] = [];

vi.mock('./sender', () => ({ sendValue: (...args: unknown[]) => void sent.push(args) }));
vi.mock('../state/preset.svelte', () => ({
  presetStore: {
    findWidget: (id: string) => {
      const widget = desk.widgets.find((w) => w.id === id);
      return widget && { desk, widget };
    },
  },
}));

const { applyInput, emitValue } = await import('./flow');
const { localValues } = await import('../state/changes');
const { values } = await import('../state/values.svelte');
const { isTouched, resetTouch } = await import('../state/touch');

const shared: LocalValueChange[] = [];
localValues.on((c) => void shared.push(c));

beforeEach(() => {
  sent.length = 0;
  shared.length = 0;
  resetTouch(() => 0);
});

describe('flow', () => {
  const fader = desk.widgets.find((w) => w.type === 'slider')!;

  it('touch: shows, sends and shares the value, and counts as touching the widget', () => {
    emitValue(fader.id, 0.4, true);
    expect(values[fader.id]).toBe(0.4);
    expect(sent).toEqual([[fader, 0.4, true]]);
    expect(shared).toEqual([
      { deskId: desk.id, widgetId: fader.id, value: 0.4, origin: 'touch', final: true },
    ]);
    expect(isTouched(fader.id)).toBe(true);
  });

  it('input: shows and shares, but sends only when forwarded, carrying the origin to avoid', () => {
    applyInput(desk.id, fader, 0.6, null);
    expect(values[fader.id]).toBe(0.6);
    expect(sent).toEqual([]);
    expect(shared.at(-1)).toMatchObject({ origin: 'input', value: 0.6 });

    const avoid = { endpointId: 'in', remote: '192.0.2.1:9000' };
    applyInput(desk.id, fader, 0.7, avoid);
    expect(sent).toEqual([[fader, 0.7, true, avoid]]);
  });

  it('ignores values for widgets that no longer exist', () => {
    emitValue('w-gone', 1);
    expect(sent).toEqual([]);
    expect(shared).toEqual([]);
  });
});
