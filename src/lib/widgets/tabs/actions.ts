// Deleting widgets or a frame's tab. A widget is work: deleting one always asks first, and so
// does a tab with widgets on it (the confirmation texts live here, once; docs/ARCHITECTURE.md ›
// Design rules). Shared by the desk (Del), the side panels and the frame's own Inspector. Like views/deskActions.ts, but in
// lib: the frame's Inspector uses them too.
import { childrenOf, tabAt, widgetsOn } from '../../model/tabs';
import { presetStore } from '../../state/preset.svelte';
import { confirmAction } from '../../state/ui.svelte';
import { sharedDesks } from '../../sync/app.svelte';
import { plural } from '../../util';
import { widgetName } from '../defs';

/** What a change to the active desk adds when the desk is shared (as views/deskActions.ts). */
function forEveryone(what: string): string[] {
  return sharedDesks.isLive(presetStore.current.id)
    ? [`This desk is shared: ${what} for everyone in the session.`]
    : [];
}

/** Deletes widgets (a frame with everything on its tabs), after asking. */
export async function removeWidgets(ids: readonly string[]): Promise<boolean> {
  const widgets = ids.flatMap((id) => presetStore.widget(id) ?? []);
  const [first] = widgets;
  if (!first) return false;
  const inside = widgets.reduce((n, w) => n + childrenOf(presetStore.current, w.id).length, 0);
  const onTabs = inside
    ? ` and the ${plural(inside, 'widget')} on ${widgets.length > 1 ? 'their frames’' : 'its'} tabs`
    : '';
  const several = widgets.length > 1;
  if (
    !(await confirmAction({
      title: several ? 'Delete widgets' : 'Delete widget',
      message: several
        ? `Delete these ${plural(widgets.length, 'widget')}${onTabs}?`
        : `Delete “${widgetName(first)}”${onTabs}?`,
      details: forEveryone(several ? 'they are deleted' : 'it is deleted'),
      confirmLabel: several ? 'Delete widgets' : 'Delete widget',
      danger: true,
    }))
  ) {
    return false;
  }
  presetStore.removeWidgets(widgets.map((w) => w.id));
  return true;
}

/** Deletes a tab of a frame; one with widgets on it asks first. */
export async function removeTab(widgetId: string, tabId: string): Promise<boolean> {
  const ref = { widget: widgetId, tab: tabId };
  const at = tabAt(presetStore.current, ref);
  if (!at || at.frame.props.tabs.length <= 1) return false;
  const on = widgetsOn(presetStore.current, ref).length;
  if (
    on > 0 &&
    !(await confirmAction({
      title: 'Delete tab',
      message: `Delete the tab “${at.tab.name}” and the ${plural(on, 'widget')} on it?`,
      details: forEveryone('it is deleted'),
      confirmLabel: 'Delete tab',
      danger: true,
    }))
  ) {
    return false;
  }
  presetStore.removeTab(widgetId, tabId);
  return true;
}
