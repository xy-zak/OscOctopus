<script lang="ts">
  // Wraps editable content. While FROZEN it becomes a disabled <fieldset>, which natively
  // disables every input, select and button inside. The app-wide FROZEN banner explains why.
  import type { Snippet } from 'svelte';
  import { ui } from '../state/ui.svelte';

  let { children }: { children: Snippet } = $props();
</script>

<fieldset disabled={ui.locked} class:locked={ui.locked}>
  {@render children()}
</fieldset>

<style>
  fieldset {
    display: contents;
    border: 0;
    margin: 0;
    padding: 0;
    min-width: 0;
  }
</style>
