// Removing a widget or a frame's tab, asking first when widgets on a frame would go with it (the
// confirmation texts live here, once). Shared by the desk (Delete), the Inspector and the frame's
// own Inspector. Like views/deskActions.ts, but in lib: the frame's Inspector uses them too.
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

/** Removes a widget; a frame with widgets on its tabs asks first. */
export async function removeWidget(id: string): Promise<boolean> {
  const w = presetStore.widget(id);
  if (!w) return false;
  const inside = childrenOf(presetStore.current, id).length;
  if (
    inside > 0 &&
    !(await confirmAction({
      title: 'Delete frame',
      message: `Delete “${widgetName(w)}” and the ${plural(inside, 'widget')} on its tabs?`,
      details: forEveryone('it is deleted'),
      confirmLabel: 'Delete',
      danger: true,
    }))
  ) {
    return false;
  }
  presetStore.removeWidget(id);
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
