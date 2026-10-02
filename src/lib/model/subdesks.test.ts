import { describe, expect, it } from 'vitest';
import { newWidget } from '../widgets/defs';
import { blankPage } from '../widgets/subdesk/def';
import { newPreset } from './factory';
import type { Parent, SubdeskWidget, Widget } from './preset';
import {
  autoColorOn,
  canHoldSubdesk,
  canPlace,
  childrenIndex,
  colorOf,
  depthOf,
  descendantsOf,
  gridOn,
  heightOf,
  levelsIn,
  orphans,
  pageKey,
  pathOf,
  pathText,
  placements,
  placesFor,
  resolvePage,
  widgetsOn,
  widgetsUnder,
} from './subdesks';

const at = { x: 0, y: 0, w: 1, h: 1 };
const pageOf = (s: SubdeskWidget, i = 0): Parent => ({ widget: s.id, page: s.props.pages[i]!.id });

/** A desk with sub-desks nested `levels` deep (each on the page of the one before), a fader on
 *  the innermost page, and a button on the desk. */
function nested(levels: number) {
  const desk = newPreset();
  desk.widgets = [newWidget('button', at, [])];
  const subs: SubdeskWidget[] = [];
  let parent: Parent | null = null;
  for (let i = 0; i < levels; i++) {
    const s: SubdeskWidget = newWidget('subdesk', at, [], i + 1, parent);
    subs.push(s);
    desk.widgets.push(s);
    parent = pageOf(s);
  }
  const fader = newWidget('slider', at, [], 1, parent);
  desk.widgets.push(fader);
  return { desk, subs, fader, button: desk.widgets[0]! };
}

const ids = (ws: Widget[]) => ws.map((w) => w.id);

describe('where widgets show', () => {
  it('puts each widget on its page, counting how deep it is', () => {
    const { desk, subs, fader, button } = nested(2);
    const placed = placements(desk);
    expect(placed.get(button.id)).toEqual({ page: null, depth: 0 });
    expect(placed.get(subs[1]!.id)).toEqual({ page: pageOf(subs[0]!), depth: 1 });
    expect(placed.get(fader.id)).toEqual({ page: pageOf(subs[1]!), depth: 2 });
    expect(ids(widgetsOn(desk, null))).toEqual([button.id, subs[0]!.id]);
    expect(ids(widgetsOn(desk, pageOf(subs[1]!)))).toEqual([fader.id]);
    const index = childrenIndex(desk);
    expect(ids(index.get('')!)).toEqual([button.id, subs[0]!.id]);
    expect(ids(index.get(pageKey(pageOf(subs[0]!)))!)).toEqual([subs[1]!.id]);
  });

  it('shows a widget whose page is gone on the desk, as an orphan', () => {
    const { desk, subs, fader } = nested(1);
    subs[0]!.props.pages = [blankPage('Other')];
    expect(placements(desk).get(fader.id)).toEqual({ page: null, depth: 0 });
    expect(ids(orphans(desk))).toEqual([fader.id]);
    // Its sub-desk gone altogether, or a parent that isn't a sub-desk: the same.
    const { desk: d2, subs: s2, fader: f2, button } = nested(1);
    d2.widgets = d2.widgets.filter((w) => w.id !== s2[0]!.id);
    expect(ids(orphans(d2))).toEqual([f2.id]);
    f2.parent = { widget: button.id, page: 'pg-x' };
    expect(ids(orphans(d2))).toEqual([f2.id]);
  });

  it('breaks a loop at the first of its widgets, on every device alike', () => {
    const desk = newPreset();
    const a: SubdeskWidget = newWidget('subdesk', at, [], 1);
    const b: SubdeskWidget = newWidget('subdesk', at, [], 2);
    a.parent = pageOf(b);
    b.parent = pageOf(a);
    desk.widgets = [a, b];
    const placed = placements(desk);
    expect(placed.get(b.id)).toEqual({ page: null, depth: 0 });
    expect(placed.get(a.id)).toEqual({ page: pageOf(b), depth: 1 });
    // A sub-desk on its own page.
    a.parent = pageOf(a);
    desk.widgets = [a];
    expect(placements(desk).get(a.id)?.page).toBeNull();
  });

  it('never nests deeper than the limit', () => {
    const { desk, subs, fader } = nested(4);
    const placed = placements(desk);
    expect(placed.get(subs[3]!.id)).toEqual({ page: pageOf(subs[2]!), depth: 3 });
    // The fader would be four deep: it shows on the desk instead.
    expect(placed.get(fader.id)).toEqual({ page: null, depth: 0 });
    expect(resolvePage(desk, pageOf(subs[3]!))).toBeNull();
    expect(resolvePage(desk, pageOf(subs[2]!))).toEqual(pageOf(subs[2]!));
  });
});

describe('the pages around a widget', () => {
  it('finds a page’s grid, depth and path', () => {
    const { desk, subs } = nested(2);
    subs[1]!.props.pages[0]!.grid = { cols: 3, rows: 2, gap: 4 };
    expect(gridOn(desk, pageOf(subs[1]!))).toEqual({ cols: 3, rows: 2, gap: 4 });
    expect(gridOn(desk, null)).toBe(desk.grid);
    expect(gridOn(desk, { widget: 'w-gone', page: 'pg-x' })).toBe(desk.grid);
    expect(depthOf(desk, null)).toBe(0);
    expect(depthOf(desk, pageOf(subs[1]!))).toBe(2);
    expect(pathOf(desk, pageOf(subs[1]!)).map((s) => s.subdesk.id)).toEqual(ids(subs));
    expect(pathOf(desk, null)).toEqual([]);
  });

  it('finds everything inside a sub-desk or under a page, at any depth', () => {
    const { desk, subs, fader } = nested(2);
    const second = blankPage('Two');
    subs[0]!.props.pages.push(second);
    const other = newWidget('button', at, [], 2, { widget: subs[0]!.id, page: second.id });
    desk.widgets.push(other);
    expect(ids(descendantsOf(desk, subs[0]!.id))).toEqual([subs[1]!.id, fader.id, other.id]);
    expect(ids(widgetsUnder(desk, pageOf(subs[0]!)))).toEqual([subs[1]!.id, fader.id]);
    expect(descendantsOf(desk, fader.id)).toEqual([]);
  });

  it('knows how many levels a sub-desk brings with it', () => {
    const { desk, subs, fader } = nested(3);
    expect(heightOf(desk, subs[0]!.id)).toBe(3);
    expect(heightOf(desk, subs[2]!.id)).toBe(1);
    expect(heightOf(desk, fader.id)).toBe(0);
  });

  it('places a widget only where it fits: never into itself, nor past the limit', () => {
    const { desk, subs, fader, button } = nested(2);
    expect(canPlace(desk, fader.id, null)).toBe(true);
    expect(canPlace(desk, button.id, pageOf(subs[1]!))).toBe(true);
    expect(canPlace(desk, subs[0]!.id, pageOf(subs[0]!))).toBe(false);
    expect(canPlace(desk, subs[0]!.id, pageOf(subs[1]!))).toBe(false);
    expect(canPlace(desk, button.id, { widget: subs[0]!.id, page: 'pg-gone' })).toBe(false);
    // A new sub-desk (one level) fits on the second level's page, not on a third.
    const extra: SubdeskWidget = newWidget('subdesk', at, [], 9);
    desk.widgets.push(extra);
    expect(canPlace(desk, extra.id, pageOf(subs[1]!))).toBe(true);
    // A sub-desk holding another brings two levels: fine one deep, four deep is too deep.
    const inner: SubdeskWidget = newWidget('subdesk', at, [], 10, pageOf(extra));
    desk.widgets.push(inner);
    expect(canPlace(desk, extra.id, pageOf(subs[0]!))).toBe(true);
    expect(canPlace(desk, extra.id, pageOf(subs[1]!))).toBe(false);
    const { desk: d3, subs: s3 } = nested(3);
    const more: SubdeskWidget = newWidget('subdesk', at, [], 9);
    d3.widgets.push(more);
    expect(canPlace(d3, more.id, pageOf(s3[2]!))).toBe(false);
  });
});

describe('what a desk or page allows', () => {
  it('counts the levels a desk holds, and where another sub-desk may go', () => {
    expect(levelsIn(nested(0).desk)).toBe(0);
    const { desk, subs } = nested(2);
    expect(levelsIn(desk)).toBe(2);
    expect(canHoldSubdesk(desk, null)).toBe(true);
    expect(canHoldSubdesk(desk, pageOf(subs[1]!))).toBe(true);
    const { desk: d3, subs: s3 } = nested(3);
    expect(canHoldSubdesk(d3, pageOf(s3[2]!))).toBe(false);
  });

  it('names a page by its path, and lists where a widget may go', () => {
    const { desk, subs, button } = nested(2);
    subs[0]!.label = 'Mixer';
    subs[0]!.props.pages[0]!.name = 'Main';
    subs[1]!.label = '';
    expect(pathText(desk, pageOf(subs[1]!))).toBe('Mixer › Main › Sub-desk › Page 1');
    expect(placesFor(desk, button.id).map((p) => p.name)).toEqual([
      'Desk',
      'Mixer › Main',
      'Mixer › Main › Sub-desk › Page 1',
    ]);
    // Never into itself or what it holds.
    expect(placesFor(desk, subs[0]!.id).map((p) => p.name)).toEqual(['Desk']);
  });

  it('colours AUTO widgets after the nearest sub-desk with a colour, else the desk', () => {
    const { desk, subs, fader } = nested(2);
    desk.color = 1;
    expect(autoColorOn(desk, pageOf(subs[1]!))).toBe(1);
    subs[0]!.color = 4;
    expect(colorOf(desk, fader)).toBe(4);
    subs[1]!.color = 7;
    expect(colorOf(desk, fader)).toBe(7);
    fader.color = 2;
    expect(colorOf(desk, fader)).toBe(2);
  });
});
