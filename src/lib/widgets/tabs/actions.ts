// Removing widgets or a frame's tab, asking first when more than one widget would go (several
// selected, or what is on a frame's tabs; the confirmation texts live here, once). Shared by the
// desk (Delete), the side panels and the frame's own Inspector. Like views/deskActions.ts, but in
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

/** Removes widgets (a frame with everything on its tabs); asks first when more than one goes. */
export async function removeWidgets(ids: readonly string[]): Promise<boolean> {
  const widgets = ids.flatMap((id) => presetStore.widget(id) ?? []);
  const [first] = widgets;
  if (!first) return false;
  const inside = widgets.reduce((n, w) => n + childrenOf(presetStore.current, w.id).length, 0);
  const onTabs = inside
    ? ` and the ${plural(inside, 'widget')} on ${widgets.length > 1 ? 'their frames’' : 'its'} tabs`
    : '';
  if (
    widgets.length + inside > 1 &&
    !(await confirmAction({
      title: widgets.length > 1 ? 'Delete widgets' : 'Delete frame',
      message:
        widgets.length > 1
          ? `Delete these ${plural(widgets.length, 'widget')}${onTabs}?`
          : `Delete “${widgetName(first)}”${onTabs}?`,
      details: forEveryone(widgets.length > 1 ? 'they are deleted' : 'it is deleted'),
      confirmLabel: 'Delete',
      danger: true,
    }))
  ) {
    return false;
  }
  presetStore.removeWidgets(widgets.map((w) => w.id));
  return true;
}

/** Removes a tab of a frame; one with widgets on it asks first. */
export async function removeTab(widgetId: string, tabId: string): Promise<boolean> {
  const ref = { widget: widgetId, tab: tabId };
  const at = tabAt(presetStore.current, ref);
  if (!at || at.frame.props.tabs.length <= 1) return false;
  const on = widgetsOn(presetStore.current, ref).length;
  if (
    on > 0 &&
    !(await confirmAction({
      title: 'Remove tab',
      message: `Remove the tab “${at.tab.name}” and the ${plural(on, 'widget')} on it?`,
      details: forEveryone('it is removed'),
      confirmLabel: 'Remove',
      danger: true,
    }))
  ) {
    return false;
  }
  presetStore.removeTab(widgetId, tabId);
  return true;
}
