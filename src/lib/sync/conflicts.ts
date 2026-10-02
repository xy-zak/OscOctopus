// Problems two people's edits can create together even though each edit was fine alone: two
// widgets moved onto the same cells, a widget left outside a grid someone else shrank, a widget
// whose sub-desk page someone deleted, a message pointing at an output someone removed. They are
// shown, never fixed automatically: only a person knows which move to undo.
import { inBounds, overlaps } from '../grid/engine';
import type { Preset } from '../model/preset';
import { childrenIndex, gridOn, orphans, pathOf, placements } from '../model/subdesks';
import { outputRefsOf } from '../widgets/defs';

export interface Conflict {
  kind: 'overlap' | 'outside' | 'orphan' | 'missingEndpoint';
  widgetIds: string[];
  text: string;
}

export function findConflicts(desk: Preset): Conflict[] {
  const out: Conflict[] = [];
  const { widgets } = desk;
  const name = (id: string) => widgets.find((w) => w.id === id)?.label || id;
  const placed = placements(desk);
  // The desk and each sub-desk page are grids of their own: only widgets on one can clash.
  const pages = [...childrenIndex(desk, placed).values()].map((onPage) => {
    const ref = placed.get(onPage[0]!.id)?.page ?? null;
    const where = pathOf(desk, ref, placed).at(-1);
    return { onPage, grid: gridOn(desk, ref), of: where ? ` of “${where.page.name}”` : '' };
  });

  for (const { onPage } of pages) {
    for (let i = 0; i < onPage.length; i++) {
      for (let j = i + 1; j < onPage.length; j++) {
        const a = onPage[i]!;
        const b = onPage[j]!;
        if (overlaps(a, b)) {
          out.push({
            kind: 'overlap',
            widgetIds: [a.id, b.id],
            text: `“${name(a.id)}” and “${name(b.id)}” overlap`,
          });
        }
      }
    }
  }
  for (const { onPage, grid, of } of pages) {
    for (const w of onPage) {
      if (!inBounds(w, grid)) {
        out.push({
          kind: 'outside',
          widgetIds: [w.id],
          text: `“${name(w.id)}” is outside the ${grid.cols}×${grid.rows} grid${of} (not shown)`,
        });
      }
    }
  }
  for (const w of orphans(desk, placed)) {
    out.push({
      kind: 'orphan',
      widgetIds: [w.id],
      text: `“${name(w.id)}” lost its sub-desk page (shown on the desk)`,
    });
  }

  const outputs = new Set(desk.network.outputs.map((o) => o.id));
  const sources = new Set([...outputs, ...desk.network.inputs.map((i) => i.id)]);
  for (const w of widgets) {
    const missing =
      w.bindings.some(
        (b) =>
          b.outputIds.some((id) => !outputs.has(id)) || b.sourceIds.some((id) => !sources.has(id)),
      ) || outputRefsOf(w).some((id) => !outputs.has(id));
    if (missing) {
      out.push({
        kind: 'missingEndpoint',
        widgetIds: [w.id],
        text: `“${name(w.id)}” has a message for an output or input that no longer exists`,
      });
    }
  }
  return out;
}
