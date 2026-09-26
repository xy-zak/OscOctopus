import { afterEach, describe, expect, it, vi } from 'vitest';
import { Autosave } from './autosave.svelte';

/** Lets pending promise callbacks run. */
const settle = () => new Promise((r) => setTimeout(r, 0));

/** A writer whose saves only finish when released, recording how many ran at once. */
function gatedWriter(result = true) {
  const waiting: (() => void)[] = [];
  const stats = { started: 0, inFlight: 0, maxInFlight: 0 };
  const write = async () => {
    stats.started++;
    stats.inFlight++;
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    await new Promise<void>((r) => waiting.push(r));
    stats.inFlight--;
    return result;
  };
  const release = async () => {
    await settle();
    waiting.shift()?.();
    await settle();
  };
  return { write, release, stats };
}

describe('Autosave', () => {
  afterEach(() => vi.useRealTimers());

  it('debounces a burst of edits into one save', async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const autosave = new Autosave(async (id) => (writes.push(id), true), 600);
    autosave.touch('d');
    autosave.touch('d');
    autosave.touch('d');
    expect(autosave.dirty.d).toBe(true);
    await vi.advanceTimersByTimeAsync(599);
    expect(writes).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(writes).toEqual(['d']);
    expect(autosave.dirty.d).toBeUndefined();
  });

  it('never runs two saves of a desk at once, and keeps an edit made mid-save dirty', async () => {
    const { write, release, stats } = gatedWriter();
    const autosave = new Autosave(write, 600);
    autosave.touch('d');
    const first = autosave.save('d');
    await settle();
    autosave.touch('d'); // edited while the first save is writing
    const second = autosave.save('d');

    await release();
    await first;
    expect(autosave.dirty.d).toBe(true); // the first save predates the edit
    await release();
    await second;
    expect(stats.maxInFlight).toBe(1);
    expect(stats.started).toBe(2);
    expect(autosave.dirty.d).toBeUndefined();
  });

  it('keeps a desk dirty when its save fails, without blocking later saves', async () => {
    let ok = false;
    const autosave = new Autosave(async () => ok, 600);
    autosave.touch('d');
    await autosave.save('d');
    expect(autosave.dirty.d).toBe(true);
    ok = true;
    await autosave.save('d');
    expect(autosave.dirty.d).toBeUndefined();
  });

  it('flushAll writes every desk with pending edits, and waits for saves in progress', async () => {
    const writes: string[] = [];
    const autosave = new Autosave(async (id) => (writes.push(id), true), 60_000);
    autosave.touch('a');
    autosave.touch('b');
    await autosave.flushAll();
    expect(writes.sort()).toEqual(['a', 'b']);
    expect(autosave.dirty).toEqual({});
    await autosave.flushAll();
    expect(writes).toHaveLength(2); // nothing pending: nothing written again
  });
});
