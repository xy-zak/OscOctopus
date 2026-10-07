<script lang="ts">
  // A labelled control. `group` is for a set of buttons (swatches, a list of choices): a
  // <label> would pass a click on its text to the first of them. A `hint` is the label's
  // tooltip (Tooltip.svelte), marked by a dotted underline.
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
    <span class="label field-label" {id}
      ><span class:has-tip={!!hint} data-tip={hint}>{label}</span></span
    >
    {@render children()}
  </div>
{:else}
  <label class="field" class:wide>
    <span class="label field-label"
      ><span class:has-tip={!!hint} data-tip={hint}>{label}</span></span
    >
    {@render children()}
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
  .label::before {
    content: '▸ ';
    color: var(--fg-faint);
  }
</style>
