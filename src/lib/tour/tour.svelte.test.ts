// The tour controller against fake app operations: the TUTORIAL desk comes and goes with the
// tour, the UI is put back, and moving stays within the steps.
import { beforeEach, describe, expect, it } from 'vitest';
import type { Place, TourStep } from './steps';
import { Tour, type TourOps } from './tour.svelte';

const step = (id: string, level: TourStep['level']): TourStep => ({
  id,
  level,
  title: id,
  body: '',
  at: { view: 'global', section: 'look' },
});
const STEPS = [
  step('a', 'easy'),
  step('b', 'easy'),
  step('c', 'intermediate'),
  step('d', 'advanced'),
];

let log: string[];
let blocked: boolean;
let saved: string | null;
let applied: { place: Place; desk: string }[];

const ops: TourOps = {
  blocked: () => blocked,
  snapshot: () => {
    log.push('snapshot');
    return () => log.push('restore');
  },
  openDesk: async () => {
    log.push('open');
    return 'p-tour';
  },
  removeDesk: async (id) => void log.push(`remove ${id}`),
  apply: (place, desk) => void applied.push({ place, desk }),
  remember: async (id) => void (saved = id),
  recall: async () => saved,
};

beforeEach(() => {
  log = [];
  blocked = false;
  saved = null;
  applied = [];
});

describe('Tour', () => {
  it('opens its desk, remembers it and shows the first step there', async () => {
    const tour = new Tour(STEPS, ops);
    expect(await tour.start()).toBe(true);
    expect(tour).toMatchObject({ active: true, index: 0 });
    expect(log).toEqual(['snapshot', 'open']);
    expect(saved).toBe('p-tour');
    expect(applied).toEqual([{ place: STEPS[0]!.at, desk: 'p-tour' }]);
  });

  it('does not start while frozen or presenting', async () => {
    blocked = true;
    const tour = new Tour(STEPS, ops);
    expect(tour.available).toBe(false);
    expect(await tour.start()).toBe(false);
    expect(log).toEqual([]);
  });

  it('moves back and forth within the steps, and jumps to a level', async () => {
    const tour = new Tour(STEPS, ops);
    await tour.start();
    tour.back();
    expect(tour.index).toBe(0);
    tour.next();
    tour.next();
    expect(tour.index).toBe(2);
    tour.jump('advanced');
    expect(tour.index).toBe(3);
    tour.jump('easy');
    expect(tour.index).toBe(0);
    expect(applied.map((a) => a.desk)).toEqual(Array(applied.length).fill('p-tour'));
  });

  it('ends after the last step: the UI goes back and the desk is deleted', async () => {
    const tour = new Tour(STEPS, ops);
    await tour.start();
    tour.jump('advanced');
    tour.next();
    await new Promise((r) => setTimeout(r, 0));
    expect(tour.active).toBe(false);
    expect(log).toEqual(['snapshot', 'open', 'restore', 'remove p-tour']);
    expect(saved).toBeNull();
  });

  it('exits the same way, once', async () => {
    const tour = new Tour(STEPS, ops);
    await tour.start();
    await tour.exit();
    await tour.exit();
    expect(log).toEqual(['snapshot', 'open', 'restore', 'remove p-tour']);
  });

  it('puts the UI back when its desk cannot be opened', async () => {
    const tour = new Tour(STEPS, {
      ...ops,
      openDesk: async () => {
        throw new Error('disk full');
      },
    });
    await expect(tour.start()).rejects.toThrow('disk full');
    expect(tour.active).toBe(false);
    expect(log).toEqual(['snapshot', 'restore']);
  });

  it('deletes a desk left over from a tour that never ended', async () => {
    saved = 'p-old';
    await new Tour(STEPS, ops).recover();
    expect(log).toEqual(['remove p-old']);
    expect(saved).toBeNull();
  });

  it('recovers nothing after a tour that ended', async () => {
    await new Tour(STEPS, ops).recover();
    expect(log).toEqual([]);
  });
});
