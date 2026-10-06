// Frames: tabs on the desk (docs/ARCHITECTURE.md › Frames). A frame (a widget of type `tabs`)
// has one or more tabs sharing one grid of its own, and a widget on a tab is an ordinary widget of
// the desk whose `parent` names that tab. Frames sit on the desk only, never on a tab. Pure:
// where each widget shows.
//
// A `parent` is only a claim: a sync merge or a hand-edited file can name a frame or tab that is
// gone, a widget that isn't a frame, or be set on a frame itself. Such a widget shows on the desk
// (an orphan, reported by sync/conflicts.ts) rather than vanishing while its messages still send
// and receive. Everything here asks `placements`, so it all agrees.
import type { Grid, Preset, Tab, TabRef, TabsWidget, Widget, WidgetType } from './preset';

/** A tab with its frame. */
export interface TabAt {
  frame: TabsWidget;
  tab: Tab;
}

/** Where every widget shows, by id: a frame's tab, or the desk (null). */
export type Placed = Map<string, TabRef | null>;

export const tabKey = (ref: TabRef | null): string => (ref ? `${ref.widget}/${ref.tab}` : '');
export const sameTab = (a: TabRef | null, b: TabRef | null) => tabKey(a) === tabKey(b);

export const isTabs = (w: Widget | undefined): w is TabsWidget => w?.type === 'tabs';

/** A tab and its frame, if both exist. */
export function tabAt(p: Preset, ref: TabRef): TabAt | undefined {
  const frame = p.widgets.find((w) => w.id === ref.widget);
  if (!isTabs(frame)) return undefined;
  const tab = frame.props.tabs.find((t) => t.id === ref.tab);
  return tab ? { frame, tab } : undefined;
}

/**
 * Where every widget of a desk shows: on the tab its `parent` names if that frame and tab exist
 * and it is no frame itself; on the desk otherwise. Nothing nests, so nothing can loop.
 */
export function placements(p: Preset): Placed {
  const frames = new Map(p.widgets.filter(isTabs).map((f) => [f.id, f]));
  const out: Placed = new Map();
  for (const w of p.widgets) {
    const ref = w.parent;
    const frame = ref && !isTabs(w) ? frames.get(ref.widget) : undefined;
    out.set(w.id, ref && frame?.props.tabs.some((t) => t.id === ref.tab) ? ref : null);
  }
  return out;
}

/** The widgets shown on each tab (`tabKey`; '' is the desk), in desk order. */
export function childrenIndex(p: Preset, placed: Placed = placements(p)): Map<string, Widget[]> {
  const index = new Map<string, Widget[]>();
  for (const w of p.widgets) {
    const key = tabKey(placed.get(w.id) ?? null);
    const list = index.get(key);
    if (list) list.push(w);
    else index.set(key, [w]);
  }
  return index;
}

/** The widgets shown on a tab (or the desk). */
export function widgetsOn(p: Preset, ref: TabRef | null, placed: Placed = placements(p)) {
  return p.widgets.filter((w) => sameTab(placed.get(w.id) ?? null, ref));
}

/** Every widget on any tab of a frame. */
export function childrenOf(p: Preset, frameId: string, placed: Placed = placements(p)) {
  return p.widgets.filter((w) => placed.get(w.id)?.widget === frameId);
}

/** The grid of a tab (its frame's, one for all its tabs), or of the desk. */
export function gridOn(p: Preset, ref: TabRef | null): Grid {
  return (ref && tabAt(p, ref)?.frame.props.grid) || p.grid;
}

/** Whether a tab (or the desk) can hold a widget of a type: the desk any, a tab all but frames. */
export function canHold(p: Preset, ref: TabRef | null, type: WidgetType | undefined): boolean {
  return !ref || (type !== 'tabs' && !!tabAt(p, ref));
}

/** Whether a widget may be put on a tab (or the desk): an existing tab, and never a frame. */
export function canPlace(p: Preset, widgetId: string, ref: TabRef | null): boolean {
  return canHold(p, ref, p.widgets.find((w) => w.id === widgetId)?.type);
}

/** The colour AUTO widgets take on a tab (or the desk): their frame's own, else the desk's. */
export function autoColorOn(p: Preset, ref: TabRef | null): number {
  return (ref ? tabAt(p, ref)?.frame.color : null) ?? p.color;
}

/** The palette colour a widget shows: its own, or what AUTO is where it is. */
export function colorOf(p: Preset, w: Widget, placed: Placed = placements(p)): number {
  return w.color ?? autoColorOn(p, placed.get(w.id) ?? null);
}

/** Widgets whose tab is gone (or that can't be on one), shown on the desk instead. */
export function orphans(p: Preset, placed: Placed = placements(p)): Widget[] {
  return p.widgets.filter((w) => w.parent && !placed.get(w.id));
}
