<script lang="ts">
  // One option of a radio list: ( ) NAME and a picture of it, like LOOK's palettes and skins.
  // The parent gives the list `role="radiogroup"`. Picking the option already chosen does
  // nothing.
  import type { Snippet } from 'svelte';

  interface Props {
    on: boolean;
    name: string;
    tip?: string;
    onpick: () => void;
    /** The name column's width, so every picture in the list starts at the same place. */
    nameWidth?: string;
    /** Room above and below the picture. */
    padY?: string;
    /** The picture, after the name. */
    children: Snippet;
  }
  let { on, name, tip, onpick, nameWidth = '12ch', padY = '3px', children }: Props = $props();
</script>

<button
  type="button"
  role="radio"
  aria-checked={on}
  class="choice"
  class:on
  data-tip={tip}
  style:--name-w={nameWidth}
  style:--pad-y={padY}
  onclick={() => !on && onpick()}
>
  <span class="radio">{on ? '(•)' : '( )'}</span>
  <span class="name">{name}</span>
  {@render children()}
</button>

<style>
  .choice {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-columns: 3ch var(--name-w) 1fr;
    gap: 1ch;
    align-items: center;
    padding: var(--pad-y) 0.5ch;
    border: 1px solid transparent;
    background: none;
    color: var(--fg-dim);
    text-align: left;
    transition:
      border-color var(--t-ui) steps(2),
      color var(--t-ui) steps(2);
  }
  .choice:hover {
    color: var(--fg);
    border-color: var(--line);
  }
  .choice.on {
    color: var(--fg);
    border-color: var(--accent);
    font-weight: 700;
  }
  .radio {
    color: var(--accent-text);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
