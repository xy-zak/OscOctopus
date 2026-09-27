// Which skin the widgets below a component use. A desk's canvas provides its desk's skin
// (GridCanvas); previews provide the skin they show (SkinScope). WidgetFrame reads it and marks
// the frame (`data-skin`, `data-base`), which is all the skin stylesheets key on, so any number
// of skins can be on screen at once. Without a provider, widgets use TERMINAL.
import { getContext, setContext } from 'svelte';
import { BUILTIN_SKINS, DEFAULT_SKIN, type SkinInfo } from './builtin';

const KEY = Symbol('skin');

/** Call during component init; `get` is re-read whenever it changes (it may read state). */
export function provideSkin(get: () => SkinInfo) {
  setContext(KEY, get);
}

/** The skin getter for this component's widgets. */
export function useSkin(): () => SkinInfo {
  return getContext<(() => SkinInfo) | undefined>(KEY) ?? (() => BUILTIN_SKINS[DEFAULT_SKIN]);
}
