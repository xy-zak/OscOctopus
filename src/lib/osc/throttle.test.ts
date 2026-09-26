import { describe, expect, it } from 'vitest';
import { OrderedQueue, Throttle, type Clock } from './throttle';

/** Deterministic clock; `advance` runs due timers and lets promise callbacks settle. */
function fakeClock() {
  let t = 0;
  let nextId = 1;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  const settle = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  const clock: Clock = {
    now: () => t,
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.push({ at: t + ms, fn, id });
      return id;
    },
    clearTimeout: (id) => {
      timers = timers.filter((x) => x.id !== id);
    },
  };
  const advance = async (ms: number) => {
    const end = t + ms;
    for (;;) {
      await settle();
      const due = timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers = timers.filter((x) => x !== due);
      t = due.at;
      due.fn();
    }
    t = end;
    await settle();
  };
  return { clock, advance };
}

describe('Throttle', () => {
  it('sends immediately, then rate limits and always delivers the last value', async () => {
    const { clock, advance } = fakeClock();
    const sent: number[] = [];
    const th = new Throttle<number>(async (v) => void sent.push(v), 10, clock);
    th.push(1);
    await advance(0);
    th.push(2);
    th.push(3);
    th.push(4);
    await advance(50);
    expect(sent).toEqual([1]);
    await advance(60);
    expect(sent).toEqual([1, 4]);
    expect(th.stats.coalesced).toBe(2);
  });

  it('never has two sends in flight and keeps order', async () => {
    const { clock, advance } = fakeClock();
    const log: string[] = [];
    const releases: (() => void)[] = [];
    const th = new Throttle<number>(
      (v) => {
        log.push(`start ${v}`);
        return new Promise<void>((resolve) =>
          releases.push(() => {
            log.push(`end ${v}`);
            resolve();
          }),
        );
      },
      0,
      clock,
    );
    th.push(1);
    th.push(2);
    th.push(3);
    await advance(0);
    expect(log).toEqual(['start 1']);
    releases.shift()!();
    await advance(0);
    expect(log).toEqual(['start 1', 'end 1', 'start 3']);
    expect(th.stats.coalesced).toBe(1);
  });

  it('flush bypasses the rate limit for the final value', async () => {
    const { clock, advance } = fakeClock();
    const sent: number[] = [];
    const th = new Throttle<number>(async (v) => void sent.push(v), 1, clock);
    th.push(1);
    await advance(0);
    th.push(2);
    th.flush();
    await advance(0);
    expect(sent).toEqual([1, 2]);
  });

  it('counts failures', async () => {
    const { clock, advance } = fakeClock();
    const th = new Throttle<number>(() => Promise.reject(new Error('x')), 0, clock);
    th.push(1);
    await advance(0);
    expect(th.stats.failed).toBe(1);
  });
});

describe('Throttle with merge', () => {
  it('merges held-back values instead of replacing them', async () => {
    const { clock, advance } = fakeClock();
    const sent: number[] = [];
    const t = new Throttle<number>(
      async (v) => void sent.push(v),
      10,
      clock,
      undefined,
      (a, b) => a + b,
    );
    t.push(1); // immediate
    t.push(1);
    t.push(1);
    t.push(1);
    await advance(200);
    expect(sent).toEqual([1, 3]);
    expect(t.stats.coalesced).toBe(2);
  });
});

describe('OrderedQueue', () => {
  it('sends every value in order, one at a time', async () => {
    const sent: number[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const resolvers: (() => void)[] = [];
    const q = new OrderedQueue<number>(
      (v) =>
        new Promise<void>((res) => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          sent.push(v);
          resolvers.push(() => {
            inFlight--;
            res();
          });
        }),
    );
    for (let i = 0; i < 5; i++) q.push(i);
    q.flush();
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
      resolvers.shift()?.();
      for (let k = 0; k < 4; k++) await Promise.resolve();
    }
    expect(sent).toEqual([0, 1, 2, 3, 4]);
    expect(maxInFlight).toBe(1);
    expect(q.stats).toEqual({ sent: 5, coalesced: 0, failed: 0 });
  });

  it('keeps going after a failed send', async () => {
    const sent: number[] = [];
    const q = new OrderedQueue<number>(async (v) => {
      sent.push(v);
      if (v === 1) throw new Error('nope');
    });
    [0, 1, 2].forEach((v) => q.push(v));
    for (let k = 0; k < 20; k++) await Promise.resolve();
    expect(sent).toEqual([0, 1, 2]);
    expect(q.stats.failed).toBe(1);
  });
});
