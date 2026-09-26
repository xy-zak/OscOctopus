<script lang="ts" generics="T">
  // Fixed-row-height virtual list. Only visible rows exist in the DOM, so a 5000-event log
  // scrolls as smoothly as a 50-event one. `follow` keeps it pinned to the newest row until
  // the user scrolls up.
  import type { Snippet } from 'svelte';

  interface Props {
    items: readonly T[];
    rowHeight: number;
    follow?: boolean;
    key: (item: T, index: number) => string | number;
    row: Snippet<[T, number]>;
  }
  let { items, rowHeight, follow = $bindable(true), key, row }: Props = $props();

  let viewport: HTMLDivElement;
  let scrollTop = $state(0);
  let height = $state(0);
  const OVERSCAN = 8;

  const start = $derived(Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN));
  const end = $derived(
    Math.min(items.length, Math.ceil((scrollTop + height) / rowHeight) + OVERSCAN),
  );
  const visible = $derived(items.slice(start, end));

  let programmatic = false;
  $effect(() => {
    void items.length;
    if (follow && viewport) {
      programmatic = true;
      viewport.scrollTop = viewport.scrollHeight;
      scrollTop = viewport.scrollTop;
    }
  });

  function onscroll() {
    scrollTop = viewport.scrollTop;
    if (programmatic) {
      programmatic = false;
      return;
    }
    const atBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < rowHeight;
    follow = atBottom;
  }
</script>

<div class="viewport scroll" bind:this={viewport} bind:clientHeight={height} {onscroll}>
  <div class="spacer" style:height="{items.length * rowHeight}px">
    {#each visible as item, i (key(item, start + i))}
      <div
        class="row"
        style:transform="translateY({(start + i) * rowHeight}px)"
        style:height="{rowHeight}px"
      >
        {@render row(item, start + i)}
      </div>
    {/each}
  </div>
</div>

<style>
  .viewport {
    height: 100%;
    position: relative;
    contain: strict;
  }
  .spacer {
    position: relative;
  }
  .row {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
  }
</style>
