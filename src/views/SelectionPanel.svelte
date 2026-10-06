<script lang="ts">
  // Edit-mode panel while several widgets are selected (Shift+click): what they are and where,
  // and deleting them all. On the desk they move, resize and nudge together; each one is edited
  // on its own in the Inspector (click it below).
  import { tabAt } from '../lib/model/tabs';
  import { presetStore } from '../lib/state/preset.svelte';
  import { lockedBy } from '../lib/sync/app.svelte';
  import { syncSession } from '../lib/sync/session.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import { widgetName } from '../lib/widgets/defs';
  import { removeWidgets } from '../lib/widgets/tabs/actions';
  import WidgetHeader from './widget/WidgetHeader.svelte';
  import WidgetRow from './WidgetRow.svelte';

  const desk = $derived(presetStore.current);
  const widgets = $derived(presetStore.selection);
  /** Where they are: all on one grid, the desk's or one frame tab's. */
  const where = $derived.by(() => {
    const at = widgets[0] && presetStore.tabOf(widgets[0].id);
    const found = at && tabAt(desk, at);
    return found ? `“${found.tab.name}” of “${widgetName(found.frame)}”` : 'the desk';
  });
  /** Ones another device is editing: until taken over (Inspector), none of them is dragged. */
  const held = $derived(
    widgets.flatMap((w) => {
      const peers = lockedBy(desk.id, w.id);
      return peers.length
        ? [`${peers.map((p) => syncSession.peerName(p)).join(', ')} › ${widgetName(w)}`]
        : [];
    }),
  );
</script>

<div class="panel-body">
  <WidgetHeader kind="SELECTION" label="{widgets.length} widgets">
    {#snippet actions()}
      <button
        class="btn icon danger"
        title="Delete them"
        onclick={() => removeWidgets(widgets.map((w) => w.id))}><Icon name="trash" /></button
      >
    {/snippet}
  </WidgetHeader>
  <p class="faint">
    On {where}. Drag one to move them all, into a frame or out of it; a handle resizes them all
    alike; arrows nudge them. Shift+click a widget to add it or take it out; click one below to edit
    it alone.
  </p>
  {#if held.length}
    <div class="held" role="status">
      {#each held as line (line)}<span>● {line}</span>{/each}
      <span>Editing elsewhere: take it over in its Inspector to move them.</span>
    </div>
  {/if}
  <ul class="list">
    {#each widgets as w (w.id)}
      <WidgetRow widget={w} />
    {/each}
  </ul>
</div>

<style>
  .panel-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  p {
    margin: 0;
  }
  .held {
    display: flex;
    flex-direction: column;
    padding: 4px 1ch;
    border: 1px solid var(--warn);
    color: var(--warn);
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
</style>
