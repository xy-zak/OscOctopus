// Widgets that are only ever shown, never on a desk: LOOK's skin picker, and the dev gallery
// (src/dev/gallery). With no desk, `emitValue` ignores them, so they can't send anything.
import type { Widget, WidgetType } from '../model/preset';
import { values } from '../state/values.svelte';
import { newWidget } from '../widgets/defs';
import type { WidgetOf } from '../widgets/types';

export interface PreviewWidget {
  widget: Widget;
  /** Stage size in CSS px. */
  size: [number, number];
}

/** A fresh widget of `type` with the id `preview-<name>` (never a desk widget's id). */
export function previewWidget<T extends WidgetType>(type: T, name: string): WidgetOf<T> {
  const w = newWidget(type, { x: 0, y: 0, w: 1, h: 1 }, []);
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
