// Problems two people's edits can create together even though each edit was fine alone: two
// widgets moved onto the same cells, a widget left outside a grid someone else shrank, a
// widget in the EDIT switch's cell, a message pointing at an output someone removed. They
// are shown, never fixed automatically: only a person knows which move to undo.
import { editCell, inBounds, overlaps } from '../grid/engine';
import type { Preset } from '../model/preset';

export interface Conflict {
  kind: 'overlap' | 'outside' | 'editCell' | 'missingEndpoint';
  widgetIds: string[];
  text: string;
}

export function findConflicts(desk: Preset): Conflict[] {
  const out: Conflict[] = [];
  const { widgets, grid } = desk;
  const name = (id: string) => widgets.find((w) => w.id === id)?.label || id;

  for (let i = 0; i < widgets.length; i++) {
    for (let j = i + 1; j < widgets.length; j++) {
      const a = widgets[i]!;
      const b = widgets[j]!;
      if (overlaps(a, b)) {
        out.push({
          kind: 'overlap',
          widgetIds: [a.id, b.id],
          text: `“${name(a.id)}” and “${name(b.id)}” overlap`,
        });
      }
    }
  }
  const edit = editCell(grid);
  for (const w of widgets) {
    if (!inBounds(w, grid)) {
      out.push({
        kind: 'outside',
        widgetIds: [w.id],
        text: `“${name(w.id)}” is outside the ${grid.cols}×${grid.rows} grid (not shown)`,
      });
    } else if (overlaps(w, edit)) {
      out.push({
        kind: 'editCell',
        widgetIds: [w.id],
        text: `“${name(w.id)}” covers the EDIT switch’s cell`,
      });
    }
  }

  const outputs = new Set(desk.network.outputs.map((o) => o.id));
  const sources = new Set([...outputs, ...desk.network.inputs.map((i) => i.id)]);
  for (const w of widgets) {
    const missing = w.bindings.some(
      (b) =>
        b.outputIds.some((id) => !outputs.has(id)) || b.sourceIds.some((id) => !sources.has(id)),
    );
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
