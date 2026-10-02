<script lang="ts">
  // EDIT, while a sub-desk page is open on the canvas: where it is, from the desk down
  // (DESK › MIXER › EFFECTS). Each step opens that level again; the last picks another page of
  // the same sub-desk. Esc goes up one level too (Desk.svelte).
  import { gridOn, pathOf } from '../lib/model/subdesks';
  import { presetStore } from '../lib/state/preset.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import { widgetName } from '../lib/widgets/defs';

  const preset = $derived(presetStore.current);
  const page = $derived(presetStore.page);
  const path = $derived(pathOf(preset, page));
  const grid = $derived(gridOn(preset, page));
  const here = $derived(path.at(-1));
</script>

{#if page && here}
  <nav class="crumbs" aria-label="Sub-desk page open">
    <button class="crumb" title="Back to the desk" onclick={() => presetStore.openPage(null)}
      >{preset.name}</button
    >
    {#each path.slice(0, -1) as step (step.subdesk.id)}
      <span class="sep" aria-hidden="true">›</span>
      <button
        class="crumb"
        onclick={() => presetStore.openPage({ widget: step.subdesk.id, page: step.page.id })}
        >{widgetName(step.subdesk)} · {step.page.name}</button
      >
    {/each}
    <span class="sep" aria-hidden="true">›</span>
    <span class="here">{widgetName(here.subdesk)}</span>
    {#if here.subdesk.props.pages.length > 1}
      <select
        class="input pages"
        aria-label="Page"
        value={here.page.id}
        onchange={(e) =>
          presetStore.openPage({ widget: here.subdesk.id, page: e.currentTarget.value })}
      >
        {#each here.subdesk.props.pages as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
      </select>
    {:else}
      <span class="here">· {here.page.name}</span>
    {/if}
    <span class="faint size">{grid.cols}×{grid.rows}</span>
    <button class="btn ghost up" title="Up one level (Esc)" onclick={() => presetStore.closePage()}
      ><Icon name="up" /> Up</button
    >
  </nav>
{/if}

<style>
  .crumbs {
    flex: none;
    display: flex;
    align-items: center;
    gap: 1ch;
    min-height: 32px;
    padding: 2px 1ch;
    border-bottom: 1px solid var(--line);
    background: var(--bg-2);
    white-space: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .crumb {
    padding: 0;
    border: 0;
    background: none;
    color: var(--fg-dim);
    text-transform: uppercase;
  }
  .crumb:hover {
    color: var(--fg);
    text-decoration: underline;
  }
  .sep {
    color: var(--fg-faint);
  }
  .here {
    color: var(--scope, var(--fg));
    font-weight: 700;
    text-transform: uppercase;
  }
  .pages {
    width: auto;
    height: 24px;
    font-weight: 700;
    text-transform: uppercase;
  }
  .size {
    margin-left: auto;
  }
  .up {
    flex: none;
  }
</style>
