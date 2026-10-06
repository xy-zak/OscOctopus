// What a desk's canvas shares with the frames drawn on it (widgets/tabs/Tabs.svelte): the desk,
// where each of its widgets shows, the selection, the drag that carries widgets between grids,
// and how pointers on a tab reach the desk (focus, LOCK). A frame draws its shown tab with the
// canvas component handed over here, so the canvas and the widgets it draws never import each
// other.
import { getContext, setContext, type Component } from 'svelte';
import type { Preset, TabRef, Widget } from '../model/preset';
import type { DragSession } from './drag.svelte';
import type { Placed } from './engine';

/** Someone else editing a widget (a sync peer): their name and colour. */
export interface Holder {
  name: string;
  color: string;
}

/** What a frame passes to draw its shown tab. */
export interface TabCanvasProps {
  tab: TabRef;
}

export interface CanvasContext {
  preset: Preset;
  /** The widgets shown on the desk and on each tab, by `tabKey` (model/tabs.ts). */
  index: Map<string, Widget[]>;
  editing: boolean;
  locked: boolean;
  /** The widgets selected, all on one grid. */
  selected: readonly string[];
  focusedId: string | null;
  /** A widget picked alone (null: none), or with `add` (Shift) added or taken out. */
  onselect: (id: string | null, add?: boolean) => void;
  onfocus?: (id: string) => void;
  /** Widgets were put down at `rects` in the grid of `parent` (a tab; null: the desk). */
  oncommit: (rects: readonly Placed[], parent: TabRef | null) => void;
  holderOf?: (id: string) => Holder | null;
  /** Carries widgets between the desk's grid and its frames' (drag.svelte.ts). */
  drag: DragSession;
  /** Draws a frame's shown tab inside it. */
  Tab: Component<TabCanvasProps>;
}

const KEY = Symbol('canvas');

export function provideCanvas(get: () => CanvasContext) {
  setContext(KEY, get);
}

/** The canvas a widget is drawn on, if any (none in LOOK's previews and the gallery). */
export function useCanvas(): (() => CanvasContext) | undefined {
  return getContext(KEY);
}
