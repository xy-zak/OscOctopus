// Copying a saved desk onto a sub-desk page (model/subdesks.ts, docs/ARCHITECTURE.md ›
// Sub-desks). Its widgets come over with fresh ids, and their messages adapt to the desk they
// join: each of the small desk's outputs becomes the big desk's output with the same target, or
// else its first output; each input the big desk's input on the same socket, or else its first.
// Nothing is added to the big desk's NETWORK, so nothing new binds a port. Pure.
import { canonical } from '../canonical';
import type { InputConfig, OutputConfig } from '../ipc/types';
import { unique } from '../util';
import { outputRefsOf, remapOutputsOf } from '../widgets/defs';
import { freshCopies } from './factory';
import { LIMITS, type Grid, type Preset, type Widget } from './preset';
import { levelsIn, placements, type PageRef } from './subdesks';

/**
 * Where a saved desk is copied: a new sub-desk on the page open (or the desk), a new page of a
 * sub-desk, or over a page copied from it before (Update from LIBRARY).
 */
export type EmbedTarget =
  | { kind: 'new' }
  | { kind: 'page'; widget: string }
  | { kind: 'update'; widget: string; page: string };

/** Two outputs that send to the same place in the same way (names and on/off aside). */
export function sameOutput(a: OutputConfig, b: OutputConfig): boolean {
  const strip = ({ id: _i, name: _n, enabled: _e, ...rest }: OutputConfig) => rest;
  return canonical(strip(a)) === canonical(strip(b));
}

/** Two inputs that listen on the same socket. */
export function sameInput(a: InputConfig, b: InputConfig): boolean {
  return (
    a.transport === b.transport &&
    a.bindAddress === b.bindAddress &&
    a.port === b.port &&
    a.multicastGroup === b.multicastGroup &&
    (a.transport !== 'tcp' || a.framing === b.framing)
  );
}

/**
 * Where one of the small desk's endpoints now goes: the big desk's endpoint of that kind with
 * the same target or socket (`same`), else its first, or nowhere (`to` null) if it has none.
 */
export type Route =
  | { kind: 'output'; from: OutputConfig; to: OutputConfig | null; same: boolean }
  | { kind: 'input'; from: InputConfig; to: InputConfig | null; same: boolean };

export interface EmbedPlan {
  /** The copies to add: the small desk's top widgets on the page, its sub-desks' as they were. */
  widgets: Widget[];
  /** The page's grid: the small desk's. */
  grid: Grid;
  /** Each endpoint the copied widgets use, and where it now goes. */
  routes: Route[];
  /** Widgets left with nothing to send to or listen on that had something before. */
  silenced: Widget[];
}

/** Why a desk can't be copied there (too deep, too many pages, no room). */
export class EmbedError extends Error {}

/** Every endpoint a widget sends to or listens on. */
const endpointsOf = (w: Widget): string[] => [
  ...w.bindings.flatMap((b) => [...b.outputIds, ...b.sourceIds]),
  ...outputRefsOf(w),
];

/** The big desk's endpoint for each of the small desk's, by the small desk's endpoint id. */
function routesFor(host: Preset, source: Preset): Map<string, Route> {
  const { outputs, inputs } = host.network;
  const routes = new Map<string, Route>();
  for (const from of source.network.outputs) {
    const same = outputs.find((o) => sameOutput(o, from));
    routes.set(from.id, { kind: 'output', from, to: same ?? outputs[0] ?? null, same: !!same });
  }
  for (const from of source.network.inputs) {
    const same = inputs.find((i) => sameInput(i, from));
    routes.set(from.id, { kind: 'input', from, to: same ?? inputs[0] ?? null, same: !!same });
  }
  return routes;
}

/**
 * The copies of `source`'s widgets for the page `slot` of `host`, whose widgets are `depth`
 * sub-desks deep. Throws an EmbedError when the source's own sub-desks would nest too deep.
 */
export function planEmbed(host: Preset, source: Preset, slot: PageRef, depth: number): EmbedPlan {
  const placedThere = placements(source);
  if (depth + levelsIn(source, placedThere) > LIMITS.subdeskDepth.max) {
    throw new EmbedError(
      `“${source.name}” has sub-desks of its own: there it would nest deeper than ${LIMITS.subdeskDepth.max}`,
    );
  }
  const routes = routesFor(host, source);
  // Messages send to outputs; they listen on inputs, or on outputs for their replies.
  const outputMap = new Map<string, string>();
  const sourceMap = new Map<string, string>();
  for (const [id, r] of routes) {
    if (!r.to) continue;
    sourceMap.set(id, r.to.id);
    if (r.kind === 'output') outputMap.set(id, r.to.id);
  }

  const { widgets, ids } = freshCopies(source.widgets);
  const originalOf = new Map([...ids].map(([from, to]) => [to, from]));
  const used = new Set<string>();
  const silenced: Widget[] = [];
  for (const w of widgets) {
    // What shows on the small desk itself (its orphans too) goes on the page.
    if (!placedThere.get(originalOf.get(w.id)!)?.page) w.parent = { ...slot };
    const before = endpointsOf(w);
    for (const id of before) used.add(id);
    for (const b of w.bindings) {
      b.outputIds = unique(b.outputIds.flatMap((id) => outputMap.get(id) ?? []));
      b.sourceIds = unique(b.sourceIds.flatMap((id) => sourceMap.get(id) ?? []));
    }
    remapOutputsOf(w, outputMap);
    if (before.length > 0 && endpointsOf(w).length === 0) silenced.push(w);
  }
  return {
    widgets,
    grid: { ...source.grid },
    routes: [...routes].filter(([id]) => used.has(id)).map(([, r]) => r),
    silenced,
  };
}

/** Whether a widget sends to outputs at all: a message that sends, or outputs of its own. */
export const sends = (w: Widget) => w.bindings.some((b) => b.send) || outputRefsOf(w).length > 0;

/** The outputs these widgets send to (a page's *Send to*), each once. */
export function sendsTo(widgets: readonly Widget[]): string[] {
  return unique(
    widgets.flatMap((w) => [
      ...w.bindings.filter((b) => b.send).flatMap((b) => b.outputIds),
      ...outputRefsOf(w),
    ]),
  );
}

/**
 * Sends everything these widgets send to one output instead (a page's *Send to*): every
 * message that sends, and every sequence that had an output.
 */
export function routeTo(widgets: readonly Widget[], outputId: string) {
  for (const w of widgets) {
    for (const b of w.bindings) if (b.send) b.outputIds = [outputId];
    remapOutputsOf(w, new Map(outputRefsOf(w).map((id) => [id, outputId])));
  }
}
