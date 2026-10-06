import { describe, expect, it } from 'vitest';
import { newWidget } from '../widgets/defs';
import { newTab } from '../widgets/tabs/def';
import { newPreset } from './factory';
import type { TabRef, TabsWidget, Widget } from './preset';
import {
  autoColorOn,
  canPlace,
  childrenIndex,
  childrenOf,
  colorOf,
  gridOn,
  orphans,
  placements,
  tabAt,
  tabKey,
  widgetsOn,
} from './tabs';

const at = { x: 0, y: 0, w: 1, h: 1 };
const tabOf = (f: TabsWidget, i = 0): TabRef => ({ widget: f.id, tab: f.props.tabs[i]!.id });

/** A desk with a button on it and a frame of two tabs, a fader on the first, a list on the second. */
function desk() {
  const p = newPreset();
  const button = newWidget('button', at, []);
  const frame: TabsWidget = newWidget('tabs', at, [], 1);
  frame.props.tabs.push(newTab('Tab 2'));
  const fader = newWidget('slider', at, [], 1, tabOf(frame));
  const list = newWidget('list', at, [], 1, tabOf(frame, 1));
  p.widgets = [button, frame, fader, list];
  return { p, button, frame, fader, list };
}

const ids = (ws: Widget[]) => ws.map((w) => w.id);

describe('where widgets show', () => {
  it('puts each widget on its tab, the rest on the desk', () => {
    const { p, button, frame, fader, list } = desk();
    const placed = placements(p);
    expect(placed.get(button.id)).toBeNull();
    expect(placed.get(frame.id)).toBeNull();
    expect(placed.get(fader.id)).toEqual(tabOf(frame));
    expect(ids(widgetsOn(p, null))).toEqual([button.id, frame.id]);
    expect(ids(widgetsOn(p, tabOf(frame, 1)))).toEqual([list.id]);
    const index = childrenIndex(p);
    expect(ids(index.get('')!)).toEqual([button.id, frame.id]);
    expect(ids(index.get(tabKey(tabOf(frame)))!)).toEqual([fader.id]);
    expect(ids(childrenOf(p, frame.id))).toEqual([fader.id, list.id]);
    expect(childrenOf(p, button.id)).toEqual([]);
  });

  it('shows a widget whose tab is gone on the desk, as an orphan', () => {
    const { p, frame, fader, list } = desk();
    frame.props.tabs = [frame.props.tabs[1]!];
    expect(placements(p).get(fader.id)).toBeNull();
    expect(ids(orphans(p))).toEqual([fader.id]);
    expect(ids(widgetsOn(p, tabOf(frame)))).toEqual([list.id]);
    // Its frame gone altogether, or a parent that isn't a frame: the same.
    const { p: p2, frame: f2, fader: x2, list: l2, button: b2 } = desk();
    p2.widgets = p2.widgets.filter((w) => w.id !== f2.id);
    expect(ids(orphans(p2))).toEqual([x2.id, l2.id]);
    x2.parent = { widget: b2.id, tab: 'tb-x' };
    expect(placements(p2).get(x2.id)).toBeNull();
  });

  it('keeps frames on the desk, whatever their parent says', () => {
    const { p, frame } = desk();
    const other: TabsWidget = newWidget('tabs', at, [], 2);
    p.widgets.push(other);
    other.parent = tabOf(frame);
    frame.parent = tabOf(frame);
    const placed = placements(p);
    expect(placed.get(other.id)).toBeNull();
    expect(placed.get(frame.id)).toBeNull();
    expect(ids(orphans(p))).toEqual([frame.id, other.id]);
  });
});

describe('tabs and their grid', () => {
  it('finds a tab with its frame, and the one grid all its tabs share', () => {
    const { p, frame } = desk();
    frame.props.grid = { cols: 3, rows: 2, gap: 4 };
    expect(tabAt(p, tabOf(frame, 1))?.tab.name).toBe('Tab 2');
    expect(tabAt(p, { widget: frame.id, tab: 'tb-gone' })).toBeUndefined();
    expect(gridOn(p, tabOf(frame))).toEqual({ cols: 3, rows: 2, gap: 4 });
    expect(gridOn(p, tabOf(frame, 1))).toBe(gridOn(p, tabOf(frame)));
    expect(gridOn(p, null)).toBe(p.grid);
    expect(gridOn(p, { widget: 'w-gone', tab: 'tb-x' })).toBe(p.grid);
  });

  it('places any widget but a frame on an existing tab, and anything on the desk', () => {
    const { p, button, frame, fader } = desk();
    expect(canPlace(p, fader.id, null)).toBe(true);
    expect(canPlace(p, frame.id, null)).toBe(true);
    expect(canPlace(p, button.id, tabOf(frame, 1))).toBe(true);
    expect(canPlace(p, button.id, { widget: frame.id, tab: 'tb-gone' })).toBe(false);
    expect(canPlace(p, button.id, { widget: fader.id, tab: 'tb-x' })).toBe(false);
    expect(canPlace(p, frame.id, tabOf(frame))).toBe(false);
    const other = newWidget('tabs', at, [], 2);
    p.widgets.push(other);
    expect(canPlace(p, other.id, tabOf(frame))).toBe(false);
  });

  it('colours AUTO widgets after their frame’s colour, else the desk’s', () => {
    const { p, frame, fader, button } = desk();
    p.color = 1;
    expect(autoColorOn(p, tabOf(frame))).toBe(1);
    expect(colorOf(p, fader)).toBe(1);
    frame.color = 4;
    expect(colorOf(p, fader)).toBe(4);
    expect(colorOf(p, button)).toBe(1);
    fader.color = 2;
    expect(colorOf(p, fader)).toBe(2);
  });
});
