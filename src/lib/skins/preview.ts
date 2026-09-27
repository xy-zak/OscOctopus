// A few widgets that show a skin at a glance (LOOK's skin picker): a button, a switch that is
// on and a half-open fader. They are never on a desk, so they can't send anything, and they
// are shown not live, so they ignore input.
import type { Widget } from '../model/preset';
import { values } from '../state/values.svelte';
import { newWidget } from '../widgets/defs';

export interface PreviewWidget {
  widget: Widget;
  /** Stage size in CSS px. */
  size: [number, number];
}

const RECT = { x: 0, y: 0, w: 1, h: 1 };

function preview(): PreviewWidget[] {
  const button = newWidget('button', RECT, []);
  button.id = 'preview-skin-button';
  button.label = 'Go';
  button.color = 1;

  const toggle = newWidget('switch', RECT, []);
  toggle.id = 'preview-skin-switch';
  toggle.label = 'On';
  toggle.color = 3;
  values[toggle.id] = toggle.props.onValue;

  const fader = newWidget('slider', RECT, []);
  fader.id = 'preview-skin-fader';
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

export const PREVIEW_WIDGETS = preview();
