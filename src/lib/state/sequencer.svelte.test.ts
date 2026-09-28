// The sequencer store against a fake core: what reaches Rust, and what the widget shows.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SeqBatch, SeqProgress } from '../ipc/types';
import { newPreset } from '../model/factory';
import type { Preset, SequencerWidget } from '../model/preset';
import { newWidget } from '../widgets/defs';

const calls: { kind: string; desk: string; widget: string; plan?: unknown }[] = [];
let push: (batch: SeqBatch) => void = () => {};
let nextRun = 0;

vi.mock('../ipc/commands', () => ({
  seq: {
    subscribe: async (cb: (batch: SeqBatch) => void) => {
      push = cb;
      return [];
    },
    start: async (desk: string, widget: string, plan: unknown) => {
      calls.push({ kind: 'start', desk, widget, plan });
      return ++nextRun;
    },
    update: async (desk: string, widget: string, plan: unknown) =>
      void calls.push({ kind: 'update', desk, widget, plan }),
    pause: async (desk: string, widget: string) => void calls.push({ kind: 'pause', desk, widget }),
    resume: async (desk: string, widget: string) =>
      void calls.push({ kind: 'resume', desk, widget }),
    stop: async (desk: string, widget: string) => void calls.push({ kind: 'stop', desk, widget }),
  },
}));
const toasts: string[] = [];
vi.mock('./ui.svelte', () => ({ toast: (text: string) => void toasts.push(text) }));
let desk: Preset;
vi.mock('./preset.svelte', () => ({
  presetStore: {
    findWidget: (id: string) => {
      const widget = desk.widgets.find((w) => w.id === id);
      return widget ? { desk, widget } : undefined;
    },
  },
}));

const { sequencerStore } = await import('./sequencer.svelte');
const { deskChanges } = await import('./changes');
const { values } = await import('./values.svelte');

let seq: SequencerWidget;

function progress(over: Partial<SeqProgress>): SeqProgress {
  return {
    desk: desk.id,
    widget: seq.id,
    run: 1,
    state: 'running',
    step: 0,
    pass: 1,
    waitMs: 500,
    leftMs: 500,
    atMicros: 0,
    ended: null,
    late: 0,
    ...over,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  calls.length = 0;
  toasts.length = 0;
  desk = newPreset('Desk');
  seq = newWidget('sequencer', { x: 0, y: 7, w: 3, h: 1 }, [desk.network.outputs[0]!.id]);
  desk.widgets.push(seq);
  await sequencerStore.start();
  for (const id of Object.keys(sequencerStore.runs)) delete sequencerStore.runs[id];
});

describe('sequencer store', () => {
  it('starts the widget’s plan and shows its progress, ignoring an older run', async () => {
    await sequencerStore.play(seq.id);
    expect(calls).toEqual([
      expect.objectContaining({ kind: 'start', desk: desk.id, widget: seq.id }),
    ]);
    const run = nextRun;
    push({ runs: [progress({ run, step: 2, pass: 3 })] });
    expect(sequencerStore.runs[seq.id]).toMatchObject({ state: 'running', step: 2, pass: 3 });
    expect(values[seq.id]).toEqual({ state: 'running', step: 3, pass: 3 });
    push({ runs: [progress({ run: run - 1, state: 'stopped', ended: 'replaced' })] });
    expect(sequencerStore.runs[seq.id]).toBeDefined();
    push({ runs: [progress({ run, state: 'stopped', ended: 'done' })] });
    expect(sequencerStore.runs[seq.id]).toBeUndefined();
    expect(values[seq.id]).toEqual({ state: 'stopped', step: 0, pass: 0 });
  });

  it('sends this device’s edits to the running sequence, but never another device’s', async () => {
    vi.useFakeTimers();
    try {
      await sequencerStore.play(seq.id);
      push({ runs: [progress({ run: nextRun })] });
      seq.props.steps[0]!.delayMs = 100;
      deskChanges.emit({ deskId: desk.id, origin: 'remote' });
      vi.advanceTimersByTime(1000);
      expect(calls.map((c) => c.kind)).toEqual(['start']);
      expect(sequencerStore.edited[seq.id]).toBe(true);
      seq.props.steps[1]!.delayMs = 200;
      deskChanges.emit({ deskId: desk.id, origin: 'local' });
      vi.advanceTimersByTime(1000);
      await vi.runAllTimersAsync();
      expect(calls.map((c) => c.kind)).toEqual(['start', 'update']);
      expect(sequencerStore.edited[seq.id]).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops a run whose widget is gone', async () => {
    await sequencerStore.play(seq.id);
    push({ runs: [progress({ run: nextRun })] });
    desk.widgets = desk.widgets.filter((w) => w.id !== seq.id);
    deskChanges.emit({ deskId: desk.id, origin: 'local' });
    await flush();
    expect(calls.map((c) => c.kind)).toEqual(['start', 'stop']);
  });

  it('never starts a widget that isn’t on a desk, and says why it can’t start', async () => {
    const preview = newWidget('sequencer', { x: 0, y: 0, w: 3, h: 1 }, ['out']);
    await sequencerStore.play(preview.id);
    seq.props.outputIds = [];
    await sequencerStore.play(seq.id);
    expect(calls).toEqual([]);
    expect(toasts).toEqual([expect.stringMatching(/can’t start: choose an output/)]);
  });

  it('pauses, resumes and stops only a run it knows', async () => {
    sequencerStore.pause(seq.id);
    await sequencerStore.play(seq.id);
    push({ runs: [progress({ run: nextRun })] });
    sequencerStore.pause(seq.id);
    sequencerStore.resume(seq.id);
    sequencerStore.stop(seq.id);
    await flush();
    expect(calls.map((c) => c.kind)).toEqual(['start', 'pause', 'resume', 'stop']);
  });
});
