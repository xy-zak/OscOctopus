// A sub-desk: a desk inside the desk, in one or more pages (tabs), each a grid of its own
// (model/subdesks.ts, docs/ARCHITECTURE.md › Sub-desks). The widgets on its pages are ordinary
// widgets of the desk, so the sub-desk itself sends and receives nothing. Its value is the
// page shown: this device's own view (`presetStore.showPage` writes it straight into `values`,
// never through osc/flow.ts), so it is never sent or shared.
import { uid } from '../../model/parts';
import {
  LIMITS,
  type Grid,
  type Preset,
  type SubdeskPage,
  type SubdeskWidget,
} from '../../model/preset';
import type { WidgetDef } from '../types';

/** The grid of a new, blank page. */
const PAGE_GRID: Grid = { cols: 6, rows: 4, gap: 6 };

/** A page name as typed: trimmed and cut to the limit ('' when nothing is left). */
export const pageName = (text: string) => text.trim().slice(0, LIMITS.pageName.max);

/** A blank page, copied from no desk. */
export function blankPage(name: string): SubdeskPage {
  return { id: uid('pg'), name, source: null, copiedAt: null, grid: { ...PAGE_GRID } };
}

/** A page copied from a saved desk: named after it, in its grid, remembering it and when. */
export function copiedPage(source: Preset): SubdeskPage {
  return {
    ...blankPage(pageName(source.name) || 'Page'),
    source: source.id,
    copiedAt: source.updatedAt,
    grid: { ...source.grid },
  };
}

/** Whether a sub-desk has as many pages as it may. */
export const pagesFull = (w: SubdeskWidget) => w.props.pages.length >= LIMITS.subdeskPages.max;

/** Why no other sub-desk (`canHoldSubdesk`) or page (`pagesFull`) can be added. */
export const TOO_DEEP = `Sub-desks nest at most ${LIMITS.subdeskDepth.max} deep`;
export const TOO_MANY_PAGES = `A sub-desk has at most ${LIMITS.subdeskPages.max} pages`;

/** The page a value shows: the one it names, or the first if that page is gone. */
export function shownPage(w: SubdeskWidget, value: unknown): SubdeskPage {
  return w.props.pages.find((p) => p.id === value) ?? w.props.pages[0]!;
}

export const subdeskDef: WidgetDef<SubdeskWidget> = {
  label: 'Sub-desk',
  readout: 'The page shown',
  defaultSize: { w: 6, h: 4 },
  create: (base, n) => ({
    ...base,
    type: 'subdesk',
    label: `Sub-desk ${n}`,
    bindings: [],
    props: { pages: [blankPage('Page 1')] },
  }),
  initialValue: (w) => w.props.pages[0]!.id,
  channels: () => [],
  gate: () => ({ kind: 'queue' }),
  input: () => null,
  echoTolerance: () => ({}),
  isValue: (w, v): v is string => typeof v === 'string' && w.props.pages.some((p) => p.id === v),
  valueText: (w, v) => shownPage(w, v).name,
  messages: () => 'none',
};
