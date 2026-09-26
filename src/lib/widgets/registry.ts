// Widget catalogue. Adding a widget type = add its schema to model/preset.ts, a component
// here, a factory case in model/factory.ts, an initialValue case in osc/mapping.ts, and an
// inspector section.
import type { Component } from 'svelte';
import type { Widget, WidgetType } from '../model/preset';
import Button from './Button.svelte';
import Graph from './Graph.svelte';
import Knob from './Knob.svelte';
import ListSwitcher from './ListSwitcher.svelte';
import Pads from './Pads.svelte';
import Slider from './Slider.svelte';
import Switch from './Switch.svelte';

export interface WidgetDef {
  label: string;
  // Each component takes its own widget subtype; the renderer passes the matching one.
  component: Component<{ widget: never; live: boolean }>;
}

/** In toolbar order. */
export const WIDGETS: Record<WidgetType, WidgetDef> = {
  button: { label: 'Button', component: Button as WidgetDef['component'] },
  switch: { label: 'Switch', component: Switch as WidgetDef['component'] },
  slider: { label: 'Fader', component: Slider as WidgetDef['component'] },
  knob: { label: 'Knob', component: Knob as WidgetDef['component'] },
  graph: { label: 'Graph', component: Graph as WidgetDef['component'] },
  pads: { label: 'Pads', component: Pads as WidgetDef['component'] },
  list: { label: 'List', component: ListSwitcher as WidgetDef['component'] },
};

export const WIDGET_TYPES = Object.keys(WIDGETS) as WidgetType[];

export function componentFor(w: Widget): Component<{ widget: Widget; live: boolean }> {
  return WIDGETS[w.type].component as unknown as Component<{ widget: Widget; live: boolean }>;
}

/**
 * The named channels a widget's value has: what message arguments and `{placeholders}` can
 * pick. Empty = a single value (no channel choice).
 */
export function channelsFor(w: Widget): { id: string; hint: string }[] {
  switch (w.type) {
    case 'graph':
      return [
        { id: 'x', hint: 'X position' },
        { id: 'y', hint: 'Y position' },
      ];
    case 'knob':
      return w.props.mode === 'endless'
        ? [
            { id: 'value', hint: 'accumulated value' },
            { id: 'delta', hint: 'change per detent (±step)' },
          ]
        : [];
    case 'pads':
      return [
        { id: 'number', hint: 'pad number, 1 = top-left' },
        { id: 'row', hint: 'row, 1 = top' },
        { id: 'col', hint: 'column, 1 = left' },
        { id: 'on', hint: 'true on hit, false on release' },
      ];
    case 'list':
      return [
        { id: 'index', hint: 'option number, 0 = first' },
        { id: 'label', hint: 'option label (string)' },
        { id: 'value', hint: 'option value' },
      ];
    default:
      return [];
  }
}
