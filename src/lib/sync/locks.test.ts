import { describe, expect, it } from 'vitest';
import { editorsOf, forwardingClashes, missingLinks, viewersOf } from './locks';
import type { Presence } from './protocol';

const presence = (p: Partial<Presence>): Presence => ({
  viewing: null,
  editing: null,
  forwarding: [],
  neighbours: [],
  locked: false,
  ...p,
});

describe('soft locks and presence', () => {
  const all = {
    bob: presence({
      viewing: 'd1',
      editing: { desk: 'd1', widgets: ['w0', 'w1'] },
      neighbours: ['me'],
    }),
    carol: presence({ viewing: 'd2', forwarding: ['d1'], neighbours: ['me'] }),
  };

  it('knows who edits a widget and who looks at a desk', () => {
    expect(editorsOf(all, 'd1', 'w1')).toEqual(['bob']);
    expect(editorsOf(all, 'd1', 'w2')).toEqual([]);
    expect(viewersOf(all, 'd2')).toEqual(['carol']);
  });

  it('spots peers that are not connected to each other', () => {
    expect(missingLinks(all, ['bob', 'carol'])).toEqual([['bob', 'carol']]);
    const linked = { ...all, bob: { ...all.bob, neighbours: ['me', 'carol'] } };
    expect(missingLinks(linked, ['bob', 'carol'])).toEqual([]);
  });

  it('spots a desk forwarded by more than one device', () => {
    expect(forwardingClashes(all, ['d1'])).toEqual(['d1']);
    expect(forwardingClashes(all, [])).toEqual([]);
  });
});
