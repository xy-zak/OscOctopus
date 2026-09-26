import { describe, expect, it } from 'vitest';
import { MAX_REGISTERS, parseBody } from './protocol';

const PEER = '0123456789abcdef';
const DOC = 'aaaaaaaaaaaaaaaa';
const stamp = [1_700_000_000_000, 0, PEER];

describe('sync protocol', () => {
  it('accepts well-formed bodies', () => {
    expect(
      parseBody('deskOps', {
        doc: DOC,
        ops: [
          ['w/fader1/label', stamp, 'Level'],
          ['w/old', stamp],
        ],
      }).ok,
    ).toBe(true);
    expect(
      parseBody('presence', {
        viewing: 'desk-1',
        editing: null,
        forwarding: [],
        neighbours: [PEER],
        locked: false,
      }).ok,
    ).toBe(true);
    expect(parseBody('values', { doc: DOC, regs: [['pads1#3', stamp, true]] }).ok).toBe(true);
  });

  it('rejects malformed or hostile bodies', () => {
    const bad = (kind: Parameters<typeof parseBody>[0], body: unknown) =>
      expect(parseBody(kind, body).ok, JSON.stringify(body).slice(0, 80)).toBe(false);
    bad('deskOps', { doc: DOC, ops: [] });
    bad('deskOps', { doc: 'nope', ops: [['name', stamp, 'x']] });
    bad('deskOps', { doc: DOC, ops: [['../etc', stamp, 'x']] });
    bad('deskOps', { doc: DOC, ops: [['name', [1, 0, 'NOT-A-PEER'], 'x']] });
    bad('deskOps', { doc: DOC, ops: [['name', [-1, 0, PEER], 'x']] });
    bad('deskOps', { doc: DOC, ops: [['name', [1, 70_000, PEER], 'x']] });
    bad('values', { doc: DOC, regs: Array(MAX_REGISTERS + 1).fill(['w', stamp, 1]) });
    bad('presence', {
      viewing: '__proto__',
      editing: null,
      forwarding: [],
      neighbours: [],
      locked: false,
    });
    bad('deskRequest', {});
  });

  it('says why a body was refused', () => {
    const r = parseBody('deskDigest', { doc: DOC, digest: 'xyz', count: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('digest');
  });
});
