// Problems two people's edits can create together even though each edit was fine alone: two
// widgets moved onto the same cells, a widget left outside a grid someone else shrank, a widget
// whose frame tab someone deleted, a message pointing at an output someone removed. They are
// shown, never fixed automatically: only a person knows which move to undo.
import { inBounds, overlaps } from '../grid/engine';
import type { Preset } from '../model/preset';
import { childrenIndex, gridOn, orphans, placements, tabAt } from '../model/tabs';
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
  // The desk and each frame's tab are places of their own: only widgets on one can clash.
  const places = [...childrenIndex(desk, placed).values()].map((on) => {
    const ref = placed.get(on[0]!.id) ?? null;
    const where = ref && tabAt(desk, ref);
    return { on, grid: gridOn(desk, ref), of: where ? ` of “${where.tab.name}”` : '' };
  });

  for (const { on } of places) {
    for (let i = 0; i < on.length; i++) {
      for (let j = i + 1; j < on.length; j++) {
        const a = on[i]!;
        const b = on[j]!;
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
  for (const { on, grid, of } of places) {
    for (const w of on) {
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
      text: `“${name(w.id)}” lost its frame tab (shown on the desk)`,
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
