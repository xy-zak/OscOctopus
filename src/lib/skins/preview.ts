// Widgets that are only ever shown, never on a desk: LOOK's skin picker, ADD's drawings of each
// widget type, and the dev gallery (src/dev/gallery). With no desk, `emitValue` ignores them, so
// they can't send anything.
import type { Widget, WidgetType } from '../model/preset';
import { values } from '../state/values.svelte';
import { DEFS, newWidget, WIDGET_TYPES } from '../widgets/defs';
import { newTab } from '../widgets/tabs/def';
import type { WidgetOf } from '../widgets/types';

export interface PreviewWidget {
  widget: Widget;
  /** Stage size in CSS px. */
  size: [number, number];
}

/**
 * A fresh widget of `type` with the id `preview-<name>` (never a desk widget's id), in `cells`
 * (what shape it takes: a fader taller than wide stands up).
 */
export function previewWidget<T extends WidgetType>(
  type: T,
  name: string,
  cells = { w: 1, h: 1 },
): WidgetOf<T> {
  const w = newWidget(type, { x: 0, y: 0, ...cells }, []);
  w.id = `preview-${name}`;
  return w;
}

/** A skin at a glance: a button, a switch that is on and a half-open fader, shown not live. */
function skinPreview(): PreviewWidget[] {
  const button = previewWidget('button', 'skin-button');
  button.label = 'Go';
  button.color = 1;

  const toggle = previewWidget('switch', 'skin-switch');
  toggle.label = 'On';
  toggle.color = 3;
  values[toggle.id] = toggle.props.onValue;

  const fader = previewWidget('slider', 'skin-fader');
  fader.label = 'Level';
  fader.color = 6;
  fader.props.orientation = 'horizontal';
  values[fader.id] = 0.6;

  return [
    { widget: button, size: [64, 60] },
    { widget: toggle, size: [96, 60] },
    { widget: fader, size: [150, 60] },
  ];
}

export const PREVIEW_WIDGETS = skinPreview();

/** The box ADD draws a widget type in: at most this wide and tall, cells at most `cell` px. */
const ADD_BOX = { w: 150, h: 100, cell: 48, gap: 4 };

/**
 * Each widget type as ADD draws it (AddPanel): a new one, named after its type and AUTO
 * coloured, in the shape of its usual size (square cells, scaled to fit the box). A frame shows
 * two tabs, to say what it is.
 */
function addPreview<T extends WidgetType>(type: T): PreviewWidget {
  const cells = DEFS[type].defaultSize;
  const { w: maxW, h: maxH, cell, gap } = ADD_BOX;
  const u = Math.min(
    cell,
    (maxW - (cells.w - 1) * gap) / cells.w,
    (maxH - (cells.h - 1) * gap) / cells.h,
  );
  const widget: Widget = previewWidget(type, `add-${type}`, cells);
  widget.label = DEFS[type].label;
  if (widget.type === 'tabs') widget.props.tabs = [newTab('Tab 1'), newTab('Tab 2')];
  return {
    widget,
    size: [
      Math.round(cells.w * u + (cells.w - 1) * gap),
      Math.round(cells.h * u + (cells.h - 1) * gap),
    ],
  };
}

export const ADD_PREVIEWS = Object.fromEntries(
  WIDGET_TYPES.map((t) => [t, addPreview(t)]),
) as Record<WidgetType, PreviewWidget>;
