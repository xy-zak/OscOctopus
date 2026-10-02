// Every widget type's Svelte components (behaviour is in defs.ts; see types.ts for what a
// widget type consists of).
import type { Component } from 'svelte';
import type { Widget, WidgetType } from '../model/preset';
import Button from './button/Button.svelte';
import ButtonInspector from './button/ButtonInspector.svelte';
import Graph from './graph/Graph.svelte';
import GraphInspector from './graph/GraphInspector.svelte';
import List from './list/List.svelte';
import ListInspector from './list/ListInspector.svelte';
import Log from './log/Log.svelte';
import LogInspector from './log/LogInspector.svelte';
import Pads from './pads/Pads.svelte';
import PadsInspector from './pads/PadsInspector.svelte';
import Sequencer from './sequencer/Sequencer.svelte';
import SequencerInspector from './sequencer/SequencerInspector.svelte';
import Slider from './slider/Slider.svelte';
import SliderInspector from './slider/SliderInspector.svelte';
import Subdesk from './subdesk/Subdesk.svelte';
import SubdeskInspector from './subdesk/SubdeskInspector.svelte';
import Switch from './switch/Switch.svelte';
import SwitchInspector from './switch/SwitchInspector.svelte';
import Text from './text/Text.svelte';
import TextInspector from './text/TextInspector.svelte';
import type { WidgetOf } from './types';

export interface WidgetViews<W extends Widget> {
  /** The widget itself. Not `live` while editing or LOCKED: it then ignores all input. */
  component: Component<{ widget: W; live: boolean }>;
  /** Editor for its props; the Inspector puts label, colour and messages around it. */
  inspector: Component<{ widget: W; onchange: () => void }, object, 'widget'>;
}

/** Typed over every WidgetType: a type without its components does not compile. */
export const VIEWS: { [T in WidgetType]: WidgetViews<WidgetOf<T>> } = {
  button: { component: Button, inspector: ButtonInspector },
  switch: { component: Switch, inspector: SwitchInspector },
  slider: { component: Slider, inspector: SliderInspector },
  graph: { component: Graph, inspector: GraphInspector },
  pads: { component: Pads, inspector: PadsInspector },
  list: { component: List, inspector: ListInspector },
  sequencer: { component: Sequencer, inspector: SequencerInspector },
  text: { component: Text, inspector: TextInspector },
  log: { component: Log, inspector: LogInspector },
  subdesk: { component: Subdesk, inspector: SubdeskInspector },
};

/** The components of a widget (see `defOf` in defs.ts for why this needs a cast). */
export function viewsOf<W extends Widget>(w: W): WidgetViews<W> {
  return VIEWS[w.type] as unknown as WidgetViews<W>;
}
