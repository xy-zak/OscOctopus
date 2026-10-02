// Sub-desks: desks inside a desk (docs/ARCHITECTURE.md › Sub-desks). A sub-desk widget has
// pages, each a grid of its own, and a widget on a page is an ordinary widget of the desk whose
// `parent` names that page. Pure: where each widget shows, and the tree of pages around it.
//
// A `parent` is only a claim: a sync merge or a hand-edited file can name a sub-desk or page
// that is gone, loop back on itself, or nest deeper than the limit. Such a widget shows on the
// desk itself (an orphan, reported by sync/conflicts.ts) rather than vanishing while its
// messages still send and receive. Everything here asks `placements`, so it all agrees.
import { widgetName } from '../widgets/defs';
import {
  LIMITS,
  type Grid,
  type Parent,
  type Preset,
  type SubdeskPage,
  type SubdeskWidget,
  type Widget,
} from './preset';

/** A sub-desk page: `widget` is the sub-desk, `page` one of its pages. null is the desk. */
export type PageRef = Parent;

/** A page with its sub-desk. */
export interface PageAt {
  subdesk: SubdeskWidget;
  page: SubdeskPage;
}

/** Where a widget shows, and how many sub-desks it is inside (0 on the desk). */
export interface Placement {
  page: PageRef | null;
  depth: number;
}

/** Every widget's placement, by id (`placements`). */
export type Placed = Map<string, Placement>;

export const pageKey = (ref: PageRef | null): string => (ref ? `${ref.widget}/${ref.page}` : '');
export const samePage = (a: PageRef | null, b: PageRef | null) => pageKey(a) === pageKey(b);

export const isSubdesk = (w: Widget | undefined): w is SubdeskWidget => w?.type === 'subdesk';

const ON_DESK: Placement = { page: null, depth: 0 };

/**
 * Where every widget of a desk shows: on the page its `parent` names if that sub-desk and page
 * exist, there is no loop and it is no deeper than `LIMITS.subdeskDepth`; on the desk
 * otherwise. A loop is broken at the first of its widgets in desk order (the same on every
 * device: sync orders widgets by when they were made). So every chain of pages ends.
 */
export function placements(p: Preset): Placed {
  const byId = new Map(p.widgets.map((w) => [w.id, w]));
  const out: Placed = new Map();
  const visiting = new Set<string>();

  const resolve = (w: Widget): Placement => {
    const known = out.get(w.id);
    if (known) return known;
    let placed = ON_DESK;
    const ref = w.parent;
    if (ref) {
      visiting.add(w.id);
      const host = byId.get(ref.widget);
      if (
        isSubdesk(host) &&
        !visiting.has(host.id) &&
        host.props.pages.some((pg) => pg.id === ref.page)
      ) {
        const depth = resolve(host).depth + 1;
        if (depth <= LIMITS.subdeskDepth.max) placed = { page: ref, depth };
      }
      visiting.delete(w.id);
    }
    out.set(w.id, placed);
    return placed;
  };
  for (const w of p.widgets) resolve(w);
  return out;
}

/** A page, then the page its sub-desk is on, and so on out to the desk. */
function* outFrom(ref: PageRef | null, placed: Placed): Generator<PageRef> {
  for (let at = ref; at; at = placed.get(at.widget)?.page ?? null) yield at;
}

/** Whether a widget is on a page that `inside` says yes to, at any depth. */
function isUnder(w: Widget, placed: Placed, inside: (at: PageRef) => boolean): boolean {
  for (const at of outFrom(placed.get(w.id)?.page ?? null, placed)) if (inside(at)) return true;
  return false;
}

/** The widgets shown on each page (`pageKey`; '' is the desk), in desk order. */
export function childrenIndex(p: Preset, placed: Placed = placements(p)): Map<string, Widget[]> {
  const index = new Map<string, Widget[]>();
  for (const w of p.widgets) {
    const key = pageKey(placed.get(w.id)?.page ?? null);
    const list = index.get(key);
    if (list) list.push(w);
    else index.set(key, [w]);
  }
  return index;
}

/** The widgets shown on a page (or the desk). */
export function widgetsOn(p: Preset, ref: PageRef | null, placed: Placed = placements(p)) {
  return childrenIndex(p, placed).get(pageKey(ref)) ?? [];
}

/** A page and its sub-desk, if both exist. */
export function pageAt(p: Preset, ref: PageRef): PageAt | undefined {
  const subdesk = p.widgets.find((w) => w.id === ref.widget);
  if (!isSubdesk(subdesk)) return undefined;
  const page = subdesk.props.pages.find((pg) => pg.id === ref.page);
  return page ? { subdesk, page } : undefined;
}

/** The grid of a page, or of the desk. */
export function gridOn(p: Preset, ref: PageRef | null): Grid {
  return (ref && pageAt(p, ref)?.page.grid) || p.grid;
}

/** How many sub-desks deep a page's widgets are (0: the desk). */
export function depthOf(p: Preset, ref: PageRef | null, placed: Placed = placements(p)): number {
  return ref ? (placed.get(ref.widget)?.depth ?? 0) + 1 : 0;
}

/**
 * The page itself if it can be shown: it exists, and its sub-desk is not so deep that its
 * widgets would be past the limit. null (the desk) otherwise.
 */
export function resolvePage(
  p: Preset,
  ref: PageRef | null,
  placed: Placed = placements(p),
): PageRef | null {
  if (!ref || !pageAt(p, ref)) return null;
  return depthOf(p, ref, placed) <= LIMITS.subdeskDepth.max ? ref : null;
}

/** Every widget shown inside a sub-desk, on any of its pages, at any depth. */
export function descendantsOf(p: Preset, widgetId: string, placed: Placed = placements(p)) {
  return p.widgets.filter((w) => isUnder(w, placed, (at) => at.widget === widgetId));
}

/** Every widget shown on a page, at any depth (its sub-desks' widgets too). */
export function widgetsUnder(p: Preset, ref: PageRef, placed: Placed = placements(p)) {
  return p.widgets.filter((w) => isUnder(w, placed, (at) => samePage(at, ref)));
}

/** How deep a widget reaches: its own depth, and a sub-desk's pages one below it (even empty). */
const reach = (w: Widget, placed: Placed) =>
  (placed.get(w.id)?.depth ?? 0) + (isSubdesk(w) ? 1 : 0);

/** How many levels of sub-desks a widget brings with it: 0 for any other widget. */
export function heightOf(p: Preset, widgetId: string, placed: Placed = placements(p)): number {
  const w = p.widgets.find((x) => x.id === widgetId);
  if (!isSubdesk(w)) return 0;
  const inside = descendantsOf(p, widgetId, placed).map((x) => reach(x, placed));
  return Math.max(reach(w, placed), ...inside) - (placed.get(widgetId)?.depth ?? 0);
}

/** How many levels of sub-desks a whole desk holds (0: none), as it brings them onto a page. */
export function levelsIn(p: Preset, placed: Placed = placements(p)): number {
  return Math.max(0, ...p.widgets.map((w) => reach(w, placed)));
}

/** Whether a new sub-desk may go on a page (or the desk): its pages within the limit. */
export function canHoldSubdesk(p: Preset, ref: PageRef | null, placed: Placed = placements(p)) {
  return depthOf(p, ref, placed) + 1 <= LIMITS.subdeskDepth.max;
}

/** The sub-desks and pages from the desk down to a page (the breadcrumb). */
export function pathOf(p: Preset, ref: PageRef | null, placed: Placed = placements(p)): PageAt[] {
  const path: PageAt[] = [];
  for (const at of outFrom(ref, placed)) {
    const found = pageAt(p, at);
    if (!found) break;
    path.unshift(found);
  }
  return path;
}

/** A page as words, from the desk down: "MIXER › EFFECTS › SUB-DESK 2 › PAGE 1". */
export function pathText(p: Preset, ref: PageRef | null, placed: Placed = placements(p)) {
  return pathOf(p, ref, placed)
    .map((step) => `${widgetName(step.subdesk)} › ${step.page.name}`)
    .join(' › ');
}

/**
 * Whether a widget may be put on a page (or the desk): never into itself or a sub-desk inside
 * it, and never so deep that it, or what it holds, would be past the limit.
 */
export function canPlace(
  p: Preset,
  widgetId: string,
  ref: PageRef | null,
  placed: Placed = placements(p),
): boolean {
  if (!ref) return true;
  if (!pageAt(p, ref) || ref.widget === widgetId) return false;
  if (descendantsOf(p, widgetId, placed).some((w) => w.id === ref.widget)) return false;
  return depthOf(p, ref, placed) + heightOf(p, widgetId, placed) <= LIMITS.subdeskDepth.max;
}

/** Every page a widget may be put on (`canPlace`), the desk first, each with its path. */
export function placesFor(
  p: Preset,
  widgetId: string,
  placed: Placed = placements(p),
): { ref: PageRef | null; name: string }[] {
  const places: { ref: PageRef | null; name: string }[] = [{ ref: null, name: 'Desk' }];
  for (const s of p.widgets) {
    if (!isSubdesk(s)) continue;
    for (const page of s.props.pages) {
      const ref = { widget: s.id, page: page.id };
      if (canPlace(p, widgetId, ref, placed)) places.push({ ref, name: pathText(p, ref, placed) });
    }
  }
  return places;
}

/**
 * The colour AUTO widgets take on a page (or the desk): that of the nearest sub-desk around it
 * with a colour of its own, else the desk's identity colour.
 */
export function autoColorOn(p: Preset, ref: PageRef | null, placed: Placed = placements(p)) {
  const own = pathOf(p, ref, placed)
    .map((step) => step.subdesk.color)
    .reverse()
    .find((c): c is number => c !== null);
  return own ?? p.color;
}

/** The palette colour a widget shows: its own, or what AUTO is where it is. */
export function colorOf(p: Preset, w: Widget, placed: Placed = placements(p)): number {
  return w.color ?? autoColorOn(p, placed.get(w.id)?.page ?? null, placed);
}

/** Widgets whose page is gone (or unreachable), shown on the desk instead. */
export function orphans(p: Preset, placed: Placed = placements(p)): Widget[] {
  return p.widgets.filter((w) => w.parent && !placed.get(w.id)?.page);
}
