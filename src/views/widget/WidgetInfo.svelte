<script lang="ts">
  // Live-mode side panel content: read-only view of the widget touched last: what it is, the
  // messages it sends right now, and what happened on the wire. No editing here.
  import type { Widget } from '../../lib/model/preset';
  import { formatValue, initialValue } from '../../lib/osc/mapping';
  import { ui } from '../../lib/state/ui.svelte';
  import { values } from '../../lib/state/values.svelte';
  import { colorVars } from '../../lib/theme/palettes';
  import Icon from '../../lib/ui/Icon.svelte';
  import { WIDGETS } from '../../lib/widgets/registry';
  import WidgetActivity from './WidgetActivity.svelte';
  import WidgetPreview from './WidgetPreview.svelte';

  let { widget }: { widget: Widget | undefined } = $props();

  function edit(w: Widget) {
    ui.mode = 'edit';
    ui.selectedId = w.id;
  }
</script>

<div class="info">
  <header>
    <div class="head">
      <span class="kind">{widget ? WIDGETS[widget.type].label.toUpperCase() : 'INFO'}</span>
      {#if widget}<span class="name">{widget.label}</span>{/if}
    </div>
    <div class="actions">
      {#if widget && !ui.locked}
        <button class="btn icon ghost" title="Edit this widget" onclick={() => edit(widget)}
          ><Icon name="pencil" /></button
        >
      {/if}
      <button class="btn icon ghost" title="Hide panel" onclick={() => (ui.infoOpen = false)}
        ><Icon name="close" /></button
      >
    </div>
  </header>

  {#if widget}
    {@const c = colorVars(widget.color)}
    <div class="value" style:--c={c.c}>
      <span class="faint">&gt;</span>
      {formatValue(values[widget.id] ?? initialValue(widget))}<span class="cursor">█</span>
    </div>
    <span class="faint">{widget.id}</span>
    <WidgetPreview {widget} />
    <WidgetActivity widgetId={widget.id} />
  {:else}
    <p class="faint">Touch a widget to see the messages it sends and what happened on the wire.</p>
  {/if}
</div>

<style>
  .info {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1ch;
  }
  .head {
    display: flex;
    gap: 1ch;
    min-width: 0;
  }
  .kind {
    flex: none;
    padding: 0 1ch;
    background: var(--fg);
    color: var(--bg);
    font-weight: 700;
  }
  .name {
    font-weight: 700;
    text-transform: uppercase;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .actions {
    display: flex;
    gap: 0.5ch;
  }
  /* A prompt line showing the live value. */
  .value {
    --c-text: var(--c);
    padding: 4px 1ch;
    border: 1px solid var(--c);
    background: var(--bg);
    color: var(--c-text);
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
  }
  :global(:root[data-mode='light']) .value {
    --c-text: color-mix(in srgb, var(--c) 50%, #000);
  }
  .cursor {
    margin-left: 0.5ch;
    animation: blink 1s steps(1) infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0;
    }
  }
  p {
    margin: 0;
  }
</style>
