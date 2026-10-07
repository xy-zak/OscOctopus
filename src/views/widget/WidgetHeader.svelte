<script lang="ts">
  // The top line of the side panel in both modes (the Inspector in EDIT, the info panel in
  // LIVE): the widget's type in reverse video, its label and id, and the panel's actions. A
  // `hint` explains the panel: the tooltip of its type tag.
  import type { Snippet } from 'svelte';

  interface Props {
    kind: string;
    hint?: string;
    label?: string;
    id?: string;
    actions?: Snippet;
  }
  let { kind, hint, label, id, actions }: Props = $props();
</script>

<header>
  <div class="head">
    <span class="kind" class:has-tip={!!hint} data-tip={hint}>{kind}</span>
    {#if label}<span class="label">{label}</span>{/if}
    {#if id}<span class="id faint">{id}</span>{/if}
  </div>
  {#if actions}<div class="actions">{@render actions()}</div>{/if}
</header>

<style>
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1ch;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 1ch;
    min-width: 0;
  }
  .kind {
    flex: none;
    padding: 0 1ch;
    background: var(--accent);
    color: var(--accent-ink);
    font-weight: 700;
  }
  .label {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-weight: 700;
    text-transform: uppercase;
  }
  .id {
    flex: none;
  }
  .actions {
    display: flex;
    gap: 0.5ch;
  }
</style>
