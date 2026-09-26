<script lang="ts">
  // A TUI box: 1px frame with the title set into the top border and optional actions set into
  // the top-right of the border.
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    actions?: Snippet;
    children: Snippet;
    active?: boolean;
    /** CSS colour for the active border and title, instead of the global accent. */
    tone?: string;
    dim?: boolean;
  }
  let { title, actions, children, active = false, tone, dim = false }: Props = $props();
</script>

<section class="panel" class:active class:dim class:toned={!!tone} style:--tone={tone}>
  <header>
    <span class="title">{title}</span>
    {#if actions}<span class="actions">{@render actions()}</span>{/if}
  </header>
  <div class="content">{@render children()}</div>
</section>

<style>
  .panel {
    --pc: var(--accent);
    --pc-text: var(--accent-text);
    position: relative;
    border: 1px solid var(--line);
    background: var(--bg-2);
    padding: 16px 12px 12px;
    margin-top: 10px;
    transition:
      border-color var(--t-ui) steps(2),
      opacity var(--t-ui) steps(3);
  }
  /* A tone used as text is darkened in light mode, like --accent-text (tokens.css). */
  .panel.toned {
    --pc: var(--tone);
    --pc-text: var(--tone);
  }
  :global(:root[data-mode='light']) .panel.toned {
    --pc-text: color-mix(in srgb, var(--tone) 55%, #000);
  }
  .panel.active {
    border-color: var(--pc);
  }
  .panel.dim {
    opacity: 0.55;
  }
  header {
    position: absolute;
    top: 0;
    left: 1ch;
    right: 1ch;
    display: flex;
    justify-content: space-between;
    align-items: center;
    translate: 0 -50%;
    pointer-events: none;
  }
  .title,
  .actions {
    background: var(--bg-2);
    pointer-events: auto;
  }
  .title {
    padding: 0 1ch;
    font-weight: 700;
    text-transform: uppercase;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--fg);
  }
  .active .title {
    color: var(--pc-text);
  }
  .actions {
    display: flex;
    gap: 0.5ch;
    padding: 0 0.5ch;
  }
  .content {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
</style>
