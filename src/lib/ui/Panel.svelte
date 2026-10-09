<script lang="ts">
  // A TUI box: 1px frame with the title set into the top border and optional actions set into
  // the top-right of the border. A `hint` explains the box: the title's tooltip.
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    hint?: string;
    actions?: Snippet;
    children: Snippet;
    /** On (a joined session, a shared desk): the accent border and title. */
    active?: boolean;
    dim?: boolean;
    /** Its `data-tour` id: what a step of the tour highlights (lib/tour/steps.ts). */
    tour?: string;
  }
  let { title, hint, actions, children, active = false, dim = false, tour }: Props = $props();
</script>

<section class="panel" class:active class:dim data-tour={tour}>
  <header>
    <span class="title"><span class:has-tip={!!hint} data-tip={hint}>{title}</span></span>
    {#if actions}<span class="actions">{@render actions()}</span>{/if}
  </header>
  <div class="content">{@render children()}</div>
</section>

<style>
  .panel {
    position: relative;
    border: 1px solid var(--line);
    background: var(--bg-2);
    padding: 16px 12px 12px;
    margin-top: 10px;
    transition:
      border-color var(--t-ui) steps(2),
      opacity var(--t-ui) steps(3);
  }
  .panel.active {
    border-color: var(--accent);
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
    color: var(--accent-text);
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
