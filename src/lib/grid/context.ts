// What a desk's canvas shares with the sub-desks drawn on it (widgets/subdesk/Subdesk.svelte):
// the desk, where each of its widgets shows, and how pointers on a page reach the desk (focus,
// LOCK). A sub-desk draws its page with the canvas component handed over here, so the canvas
// and the widgets it draws never import each other.
import { getContext, setContext, type Component } from 'svelte';
import type { Preset, Widget } from '../model/preset';
import type { PageRef } from '../model/subdesks';

/** What a sub-desk passes to draw one of its pages. */
export interface PageCanvasProps {
  page: PageRef;
}

export interface CanvasContext {
  preset: Preset;
  /** The widgets shown on each page, by `pageKey` (model/subdesks.ts). */
  index: Map<string, Widget[]>;
  /** The desk is being edited: what is on a page is shown, not played. */
  editing: boolean;
  locked: boolean;
  focusedId: string | null;
  onfocus?: (id: string) => void;
  /** Draws a page of a sub-desk inside it. */
  Page: Component<PageCanvasProps>;
}

const KEY = Symbol('canvas');

export function provideCanvas(get: () => CanvasContext) {
  setContext(KEY, get);
}

/** The canvas a widget is drawn on, if any (none in LOOK's previews and the gallery). */
export function useCanvas(): (() => CanvasContext) | undefined {
  return getContext(KEY);
}
