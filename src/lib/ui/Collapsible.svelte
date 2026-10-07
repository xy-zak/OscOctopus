<script lang="ts">
  // A TUI box whose content folds away. The header bar is the toggle: ▾ open / ▸ closed, the
  // title, and (while closed) a one-line summary of what's inside. Actions sit on the right of
  // the bar while open. The content is unmounted while closed.
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    open: boolean;
    ontoggle: (open: boolean) => void;
    /** Shown in the header while closed. */
    summary?: string;
    actions?: Snippet;
    children: Snippet;
  }
  let { title, open, ontoggle, summary, actions, children }: Props = $props();
  const id = $props.id();
</script>

<div class="fold" class:open>
  <div class="bar">
    <button class="toggle" aria-expanded={open} aria-controls={id} onclick={() => ontoggle(!open)}>
      <span class="caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
      <span class="title">{title}</span>
      {#if !open && summary}<span class="summary">{summary}</span>{/if}
    </button>
    {#if open && actions}<span class="actions">{@render actions()}</span>{/if}
  </div>
  {#if open}
    <div class="content" {id}>{@render children()}</div>
  {/if}
</div>

<style>
  .fold {
    border: 1px solid var(--line);
    transition: border-color var(--t-ui) steps(2);
  }
  .fold.open {
    border-color: var(--line-strong);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 1ch;
    background: var(--bg-2);
  }
  .open .bar {
    border-bottom: 1px solid var(--line);
  }
  .toggle {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 1ch;
    height: var(--control-h);
    padding: 0 1ch;
    border: 0;
    background: none;
    color: var(--fg-dim);
    text-align: left;
  }
  .toggle:hover {
    color: var(--fg);
  }
  .caret {
    flex: none;
    width: 1ch;
    color: var(--accent-text);
  }
  .title {
    flex: none;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--fg);
  }
  .summary {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--fg-faint);
  }
  .actions {
    display: flex;
    gap: 0.5ch;
    padding-right: 0.5ch;
  }
  .content {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px 1ch;
    animation: unfold var(--t-release) steps(3, end);
  }
  @keyframes unfold {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }
</style>
