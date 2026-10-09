// The tour's steps: grouped by level, in order, and every highlight pointing at a hook that
// exists in the markup.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEVELS, levelRanges, placeKey, STEPS, targetsOf, type TourStep } from './steps';

/** Every `data-tour="x"` and `tour="x"` in src's Svelte files. */
function hooks(): Set<string> {
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, e.name);
      if (e.isDirectory()) walk(path);
      else if (e.name.endsWith('.svelte'))
        for (const m of readFileSync(path, 'utf8').matchAll(/\btour="([a-z-]+)"/g))
          found.add(m[1]!);
    }
  };
  walk('src');
  return found;
}

describe('tour steps', () => {
  it('have unique ids', () => {
    expect(new Set(STEPS.map((s) => s.id)).size).toBe(STEPS.length);
  });

  it('run easy, intermediate, advanced, none of them empty', () => {
    const order = LEVELS.map((l) => l.id);
    const levels = STEPS.map((s) => order.indexOf(s.level));
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
    for (const r of levelRanges(STEPS)) expect(r.count).toBeGreaterThan(0);
  });

  it('have fifteen steps in each level', () => {
    expect(levelRanges(STEPS).map((r) => r.count)).toEqual([15, 15, 15]);
  });

  it('finish a page before moving on: within a level, no page is visited twice', () => {
    for (const r of levelRanges(STEPS)) {
      const pages = STEPS.slice(r.start, r.start + r.count).map((s) => placeKey(s.at));
      const runs = pages.filter((p, i) => p !== pages[i - 1]);
      expect(runs, r.level).toEqual([...new Set(runs)]);
    }
  });

  it('highlight only hooks that exist', () => {
    const known = hooks();
    const missing = STEPS.flatMap(targetsOf).filter((id) => !known.has(id));
    expect(missing).toEqual([]);
  });

  it('start and end without a highlight', () => {
    expect(targetsOf(STEPS[0]!)).toEqual([]);
    expect(targetsOf(STEPS.at(-1)!)).toEqual([]);
  });
});

describe('levelRanges', () => {
  const step = (id: string, level: TourStep['level']): TourStep => ({
    id,
    level,
    title: id,
    body: '',
    at: { view: 'global', section: 'look' },
  });

  it('gives each level its first step and count', () => {
    const steps = [
      step('a', 'easy'),
      step('b', 'easy'),
      step('c', 'intermediate'),
      step('d', 'advanced'),
    ];
    expect(levelRanges(steps)).toEqual([
      { level: 'easy', start: 0, count: 2 },
      { level: 'intermediate', start: 2, count: 1 },
      { level: 'advanced', start: 3, count: 1 },
    ]);
  });
});
