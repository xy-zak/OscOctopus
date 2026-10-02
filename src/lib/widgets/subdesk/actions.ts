// Sub-desk actions that ask first (the confirmation texts live here, once): copying a saved desk
// in (as a sub-desk, a page, or again over a page), and removing a sub-desk or a page with
// widgets on it. Shared by the desk (its toolbar, Delete), the Inspector and the sub-desk's own
// Inspector. Like views/deskActions.ts, but in lib: the sub-desk's Inspector uses them too.
import { EmbedError, type EmbedPlan, type EmbedTarget, type Route } from '../../model/embed';
import type { Preset } from '../../model/preset';
import { descendantsOf, pageAt, widgetsUnder } from '../../model/subdesks';
import { presetStore } from '../../state/preset.svelte';
import { confirmAction, toast } from '../../state/ui.svelte';
import { sharedDesks } from '../../sync/app.svelte';
import { errorText, plural } from '../../util';
import { widgetName } from '../defs';

/** What a change to the active desk adds when the desk is shared (as views/deskActions.ts). */
function forEveryone(what: string): string[] {
  return sharedDesks.isLive(presetStore.current.id)
    ? [`This desk is shared: ${what} for everyone in the session.`]
    : [];
}

/** Where one of the copied desk's endpoints now goes, in words. */
function routeText(r: Route): string {
  if (!r.to) {
    const what = r.kind === 'output' ? 'sends' : 'listens';
    return `“${r.from.name}” ${what} nowhere: this desk has no ${r.kind} yet`;
  }
  const where = r.kind === 'output' ? `${r.to.host}:${r.to.port}` : `port ${r.to.port}`;
  return `“${r.from.name}” → this desk’s “${r.to.name}” (${r.same ? 'the same, ' : ''}${where})`;
}

/** Where a copy's messages go, as confirmation details. */
function routeDetails(plan: EmbedPlan): string[] {
  const out = plan.routes.length
    ? plan.routes.map(routeText)
    : ['Its widgets have no messages to send or receive.'];
  out.push('This desk’s NETWORK doesn’t change: the copies use its outputs and inputs.');
  if (plan.silenced.length) {
    out.push(
      `${plural(plan.silenced.length, 'widget')} send or listen nowhere until given an output or input (MESSAGES).`,
    );
  }
  return out;
}

/** Asks before copying `source` to `target`: what it adds or replaces, and where it sends. */
function confirmEmbed(target: EmbedTarget, plan: EmbedPlan, source: Preset): Promise<boolean> {
  const copies = plural(plan.widgets.length, 'widget');
  if (target.kind === 'update') {
    const ref = { widget: target.widget, page: target.page };
    const at = pageAt(presetStore.current, ref);
    const on = widgetsUnder(presetStore.current, ref).length;
    return confirmAction({
      title: 'Update from LIBRARY',
      message: `Copy “${source.name}” again over the page “${at?.page.name}” of “${at ? widgetName(at.subdesk) : ''}”?`,
      details: [
        `Its ${plural(on, 'widget')} are replaced by ${copies}, including anything added or changed here since it was copied.`,
        ...routeDetails(plan),
        ...forEveryone('the page is replaced'),
      ],
      confirmLabel: 'Replace',
      danger: true,
    });
  }
  const into = target.kind === 'page' ? presetStore.widget(target.widget) : undefined;
  return confirmAction({
    title: into ? 'Add page' : 'Add sub-desk',
    message: into
      ? `Copy “${source.name}” (${copies}) into “${widgetName(into)}” as a new page?`
      : `Copy “${source.name}” (${copies}) into this desk as a sub-desk?`,
    details: [
      'The copy is this desk’s own: change it here, the saved desk stays as it is.',
      ...routeDetails(plan),
    ],
    confirmLabel: 'Add',
  });
}

/**
 * Copies a saved desk into the active one (presetStore.embed): as a new sub-desk on the page
 * open, as a new page of a sub-desk, or again over a page copied from it (Update from LIBRARY,
 * which replaces what is on that page). Asks first, showing where its messages will go.
 */
export async function embedDesk(sourceId: string, target: EmbedTarget): Promise<boolean> {
  try {
    return await presetStore.embed(sourceId, target, (plan, source) =>
      confirmEmbed(target, plan, source),
    );
  } catch (e) {
    toast(
      e instanceof EmbedError ? e.message : `Could not copy the desk: ${errorText(e)}`,
      'error',
    );
    return false;
  }
}

/** Removes a widget; a sub-desk with widgets on its pages asks first. */
export async function removeWidget(id: string): Promise<boolean> {
  const w = presetStore.widget(id);
  if (!w) return false;
  const inside = descendantsOf(presetStore.current, id).length;
  if (
    inside > 0 &&
    !(await confirmAction({
      title: 'Delete sub-desk',
      message: `Delete “${widgetName(w)}” and the ${plural(inside, 'widget')} on its pages?`,
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

/** Removes a page of a sub-desk; one with widgets on it asks first. */
export async function removePage(widgetId: string, pageId: string): Promise<boolean> {
  const ref = { widget: widgetId, page: pageId };
  const at = pageAt(presetStore.current, ref);
  if (!at || at.subdesk.props.pages.length <= 1) return false;
  const on = widgetsUnder(presetStore.current, ref).length;
  if (
    on > 0 &&
    !(await confirmAction({
      title: 'Remove page',
      message: `Remove the page “${at.page.name}” and the ${plural(on, 'widget')} on it?`,
      details: forEveryone('it is removed'),
      confirmLabel: 'Remove',
      danger: true,
    }))
  ) {
    return false;
  }
  presetStore.removePage(widgetId, pageId);
  return true;
}
