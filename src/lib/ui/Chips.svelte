<script lang="ts">
  // Picks some of a list: one chip per item, reverse video while picked. An id that is picked
  // but no longer listed (a removed output, widget, …) shows as "missing"; clicking removes
  // it. `picked` is changed in place, then `onchange` runs.
  import type { Tone } from './status';
  interface Item {
    id: string;
    name: string;
    title?: string;
    /** A status lamp before the name (an endpoint's state, as toneOf says it). */
    lamp?: Tone;
  }
  interface Props {
    items: readonly Item[];
    picked: string[];
    onchange: () => void;
    /** Shown when there is nothing to pick. */
    empty: string;
    /** What a missing chip means. */
    missingTitle: string;
  }
  let { items, picked, onchange, empty, missingTitle }: Props = $props();

  const missing = $derived(picked.filter((id) => !items.some((it) => it.id === id)));

  function toggle(id: string) {
    const i = picked.indexOf(id);
    if (i >= 0) picked.splice(i, 1);
    else picked.push(id);
    onchange();
  }
</script>

<div class="chips">
  {#each items as it (it.id)}
    <button
      type="button"
      class="chip"
      class:on={picked.includes(it.id)}
      data-tip={it.title}
      onclick={() => toggle(it.id)}
    >
      {#if it.lamp !== undefined}<span class="lamp {it.lamp}"></span>{/if}{it.name}
    </button>
  {/each}
  {#each missing as id (id)}
    <button type="button" class="chip on missing" data-tip={missingTitle} onclick={() => toggle(id)}
      >missing: {id}</button
    >
  {/each}
  {#if items.length === 0}<span class="faint">{empty}</span>{/if}
</div>

<style>
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 1ch;
    height: 24px;
    padding: 0 1ch;
    border: 1px solid var(--line-strong);
    background: var(--bg);
    color: var(--fg-dim);
    transition:
      background var(--t-ui) steps(2),
      color var(--t-ui) steps(2);
  }
  .chip.on {
    border-color: var(--fg);
    background: var(--fg);
    color: var(--bg);
  }
  .chip.missing {
    border-color: var(--danger);
    color: var(--danger);
  }
  .lamp {
    width: 7px;
    height: 7px;
    background: var(--fg-faint);
    box-shadow: 0 0 0 1px var(--bg);
  }
  .lamp.ok {
    background: var(--ok);
  }
  .lamp.bad {
    background: var(--danger);
  }
  .lamp.warn {
    background: var(--warn);
  }
</style>
