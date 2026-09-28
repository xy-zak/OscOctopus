<script lang="ts">
  // A labelled control. `group` is for a set of buttons (swatches, a list of choices): a
  // <label> would pass a click on its text to the first of them.
  import type { Snippet } from 'svelte';
  interface Props {
    label: string;
    hint?: string;
    wide?: boolean;
    group?: boolean;
    children: Snippet;
  }
  let { label, hint, wide = false, group = false, children }: Props = $props();
  const id = $props.id();
</script>

{#if group}
  <div class="field" class:wide role="group" aria-labelledby={id}>
    <span class="label" {id}>{label}</span>
    {@render children()}
    {#if hint}<span class="hint">{hint}</span>{/if}
  </div>
{:else}
  <label class="field" class:wide>
    <span class="label">{label}</span>
    {@render children()}
    {#if hint}<span class="hint">{hint}</span>{/if}
  </label>
{/if}

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .wide {
    grid-column: 1 / -1;
  }
  .label {
    color: var(--fg-dim);
    text-transform: uppercase;
  }
  .label::before {
    content: '▸ ';
    color: var(--fg-faint);
  }
  .hint {
    color: var(--fg-faint);
  }
</style>
