<script lang="ts">
  // The top line of the side panel in both modes (the Inspector in EDIT, the info panel in
  // LIVE): the widget's type in reverse video, its label and id, and the panel's actions.
  import type { Snippet } from 'svelte';

  interface Props {
    kind: string;
    label?: string;
    id?: string;
    actions?: Snippet;
  }
  let { kind, label, id, actions }: Props = $props();
</script>

<header>
  <div class="head">
    <span class="kind">{kind}</span>
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
