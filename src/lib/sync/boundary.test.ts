// Peer changes must never send OSC: only the app where an action happened sends it (see
// osc/flow.ts). The simplest way to guarantee that is that no sync module can reach the
// sender, directly or through the router.
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob(['./**/*.ts', './**/*.svelte', '!./**/*.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const FORBIDDEN = /from\s+['"][./]*osc\/(sender|flow)['"]/;

describe('sync import boundary', () => {
  it('finds the sync modules', () => {
    expect(Object.keys(sources)).toContain('./session.svelte.ts');
  });

  it.each(Object.entries(sources))('%s does not import the OSC sender or router', (_, text) => {
    expect(text).not.toMatch(FORBIDDEN);
  });

  it('would catch such an import', () => {
    expect("import { sendValue } from '../osc/sender';").toMatch(FORBIDDEN);
    expect("import { emitValue } from '../osc/flow';").toMatch(FORBIDDEN);
  });
});
