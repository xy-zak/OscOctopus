<script lang="ts">
  import type { Snippet } from 'svelte';
  interface Props {
    label: string;
    hint?: string;
    wide?: boolean;
    children: Snippet;
  }
  let { label, hint, wide = false, children }: Props = $props();
</script>

<label class="field" class:wide>
  <span class="label">{label}</span>
  {@render children()}
  {#if hint}<span class="hint">{hint}</span>{/if}
</label>

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
