import { describe, expect, it } from 'vitest';
import { canonical } from '../canonical';
import { newPreset } from '../model/factory';
import { baseOf, DeskDoc, localChanges, type Entry } from './deskdoc';
import { flatten, isNetworkKey, materialize, ownerKey, parseKey, validEntry } from './paths';
import type { Stamp } from './protocol';

const A = 'aaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbb';
const DOC = 'dddddddddddddddd';

/** A record of a desk with every field stamped [t, i, peer]. */
function recordOf(desk = newPreset('Desk'), t = 1000, peer = A) {
  const doc = new DeskDoc(desk.id, DOC);
  let i = 0;
  doc.merge([...flatten(desk)].map(([k, v]) => [k, { stamp: [t, i++, peer], value: v }]));
  return { desk, doc };
}

const set = (key: string, stamp: Stamp, value: unknown): [string, Entry] => [key, { stamp, value }];
const del = (key: string, stamp: Stamp): [string, Entry] => [key, { stamp, deleted: true }];

describe('desk record paths', () => {
  it('parses every key of a flattened desk and knows its owner', () => {
    const desk = newPreset('Desk');
    for (const key of flatten(desk).keys()) expect(parseKey(key), key).not.toBeNull();
    const w = desk.widgets[0]!.id;
    expect(ownerKey(`w/${w}/props/min`)).toBe(`w/${w}`);
    expect(ownerKey('name')).toBeNull();
    expect(parseKey('w/../x')).toBeNull();
    expect(parseKey('w/a/unknown')).toBeNull();
    expect(isNetworkKey(`o/${desk.network.outputs[0]!.id}/cfg`)).toBe(true);
  });

  it('keeps machine-specific endpoint fields out of the record', () => {
    const desk = newPreset('Desk');
    desk.network.outputs[0]!.bindAddress = '192.168.1.20';
    const cfg = flatten(desk).get(`o/${desk.network.outputs[0]!.id}/cfg`) as object;
    expect(cfg).not.toHaveProperty('bindAddress');
    expect(cfg).not.toHaveProperty('localPort');
    expect(cfg).not.toHaveProperty('id');
  });

  it('validates values per key', () => {
    const none = () => undefined;
    expect(validEntry('name', 'Stage', none)).toBe(true);
    expect(validEntry('name', '', none)).toBe(false);
    expect(validEntry('color', 99, none)).toBe(false);
    expect(validEntry('w/a/rect', { x: 0, y: 0, w: 1, h: 1 }, none)).toBe(true);
    expect(validEntry('w/a/rect', { x: -1, y: 0, w: 1, h: 1 }, none)).toBe(false);
    expect(validEntry('w/a', { type: 'rocket' }, none)).toBe(false);
    expect(validEntry('w/a/props/min', 'x', () => 'slider')).toBe(false);
    expect(validEntry('w/a/props/nope', 1, () => 'slider')).toBe(false);
    expect(validEntry('w/a/props/min', 0, () => 'slider')).toBe(true);
    expect(validEntry('o/x', { sneaky: 1 }, none)).toBe(false);
  });

  it('materializes a record back into the same desk (a fixpoint)', () => {
    const { desk, doc } = recordOf();
    const { desk: out, invalid } = materialize(doc, desk);
    expect(invalid).toEqual([]);
    expect(canonical(out)).toBe(canonical(desk));
    // Nothing to send after applying what was received.
    const { changed, missing } = localChanges(flatten(out), baseOf(flatten(desk)));
    expect(changed).toEqual([]);
    expect(missing).toEqual([]);
  });

  it('keeps this machine’s bind addresses when building from a record', () => {
    const { desk, doc } = recordOf();
    const mine = structuredClone(desk);
    mine.network.outputs[0]!.bindAddress = '10.0.0.5';
    mine.network.outputs[0]!.localPort = 7000;
    const out = materialize(doc, mine).desk.network.outputs[0]!;
    expect(out.bindAddress).toBe('10.0.0.5');
    expect(out.localPort).toBe(7000);
  });

  it('hides a widget that cannot be built instead of failing', () => {
    const { desk, doc } = recordOf();
    const w = desk.widgets[0]!.id;
    doc.merge([set(`w/${w}/props/min`, [9999, 0, B], 'not a number')]);
    const { desk: out, invalid } = materialize(doc, desk);
    expect(out.widgets.map((x) => x.id)).not.toContain(w);
    expect(invalid[0]?.key).toBe(`w/${w}`);
  });
});

describe('desk record merge', () => {
  it('keeps the later change per field, whatever the order', () => {
    const desk = newPreset('Desk');
    const one = recordOf(desk).doc;
    const two = recordOf(desk).doc;
    const x = set('name', [2000, 0, A], 'From A');
    const y = set('name', [2000, 0, B], 'From B');
    one.merge([x, y]);
    two.merge([y, x]);
    expect(one.live('name')).toBe('From B');
    expect(one.digest()).toBe(two.digest());
    // Idempotent.
    expect(one.merge([x, y])).toEqual([]);
  });

  it('decides identical stamps by content, so replicas still agree', () => {
    const desk = newPreset('Desk');
    const one = recordOf(desk).doc;
    const two = recordOf(desk).doc;
    const x = set('name', [5000, 0, A], 'x');
    const y = set('name', [5000, 0, A], 'y');
    one.merge([x]);
    one.merge([y]);
    two.merge([y]);
    two.merge([x]);
    expect(one.live('name')).toBe(two.live('name'));
  });

  it('a deletion beats a concurrent edit of the widget’s fields', () => {
    const { desk, doc } = recordOf();
    const w = desk.widgets[0]!.id;
    doc.merge([del(`w/${w}`, [3000, 0, A]), set(`w/${w}/label`, [3001, 0, B], 'Renamed')]);
    const out = materialize(doc, desk).desk;
    expect(out.widgets.map((x) => x.id)).not.toContain(w);
    expect(doc.isDeleted(`w/${w}`)).toBe(true);
  });

  it('a later re-creation brings a widget back (keeping it after a remote delete)', () => {
    const { desk, doc } = recordOf();
    const w = desk.widgets[0]!.id;
    doc.merge([del(`w/${w}`, [3000, 0, A])]);
    doc.merge([set(`w/${w}`, [4000, 0, B], { type: desk.widgets[0]!.type })]);
    expect(materialize(doc, desk).desk.widgets.map((x) => x.id)).toContain(w);
  });

  it('orders widgets by when they were created', () => {
    const { desk, doc } = recordOf();
    const first = desk.widgets[0]!;
    doc.merge([set(`w/${first.id}`, [9000, 0, B], { type: first.type })]);
    const out = materialize(doc, desk).desk;
    expect(out.widgets.at(-1)!.id).toBe(first.id);
  });

  it('digests differ when any key, stamp or content differs', () => {
    const desk = newPreset('Desk');
    const one = recordOf(desk).doc;
    const two = recordOf(desk).doc;
    expect(one.digest()).toBe(two.digest());
    two.merge([set('name', [2000, 0, A], 'x')]);
    expect(one.digest()).not.toBe(two.digest());
    one.merge([set('name', [2000, 0, A], 'x')]);
    expect(one.digest()).toBe(two.digest());
  });

  it('round-trips through the wire format', () => {
    const { desk, doc } = recordOf();
    doc.merge([del(`w/${desk.widgets[1]!.id}`, [3000, 0, A])]);
    const copy = new DeskDoc(desk.id, DOC);
    copy.mergeWire(doc.wire());
    expect(copy.digest()).toBe(doc.digest());
    expect(copy.maxStamp()).toEqual([3000, 0, A]);
  });
});
