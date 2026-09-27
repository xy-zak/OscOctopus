<script lang="ts">
  // A key cap seen head-on, standing out of the panel towards you: the face is a smaller
  // rectangle in the middle, joined to the base by four corner edges and four walls. Pressed,
  // the cap sinks back until it is almost flush with the panel. This lays out the shape (the
  // depth `--d`, the walls, the edge lines); the skin paints it (keycap parts in
  // skins/anatomy.ts), e.g. TERMINAL shades the walls with dots lit from the top-left. A skin
  // with flat keys (GLASS) gets just the face: no walls, edges or measuring.
  import type { Snippet } from 'svelte';
  import { flag } from '../skins/anatomy';
  import { useSkin } from '../skins/context';

  interface Props {
    /** Height of the cap in px at most; smaller keys stand out proportionally less. */
    depth?: number;
    down?: boolean;
    children?: Snippet;
  }
  let { depth = 12, down = false, children }: Props = $props();

  const skin = useSkin();
  const flat = $derived(skin().params.keycap === 'flat');

  let w = $state(0);
  let h = $state(0);
  const up = $derived(Math.round(Math.max(2, Math.min(depth, Math.min(w, h) * 0.12))));
  const d = $derived(down ? Math.max(1, Math.round(up / 4)) : up);
  // The four corner edges, from each outer corner in to the matching corner of the face
  // (half-pixel offsets keep 1px lines crisp).
  const corners = $derived.by(() => {
    const [l, t, r, b] = [0.5, 0.5, w - 0.5, h - 0.5];
    return [
      `M${l} ${t}L${l + d} ${t + d}`,
      `M${r} ${t}L${r - d} ${t + d}`,
      `M${r} ${b}L${r - d} ${b - d}`,
      `M${l} ${b}L${l + d} ${b - d}`,
    ].join('');
  });
</script>

{#if flat}
  <span class="key" data-part="keycap" data-style="flat" data-down={flag(down)} style:--d="0px">
    <span class="face" data-part="keycap.face">{@render children?.()}</span>
  </span>
{:else}
  <span
    class="key"
    data-part="keycap"
    data-style="bevel"
    data-down={flag(down)}
    bind:clientWidth={w}
    bind:clientHeight={h}
    style:--d="{d}px"
  >
    {#each ['top', 'left', 'right', 'bottom'] as side (side)}
      <span class="wall {side}" data-part="keycap.wall" data-side={side} aria-hidden="true"></span>
    {/each}
    {#if w > 2 * d && h > 2 * d}
      <svg
        class="edges"
        data-part="keycap.edges"
        width={w}
        height={h}
        aria-hidden="true"
        shape-rendering="crispEdges"
      >
        <rect x="0.5" y="0.5" width={w - 1} height={h - 1} />
        <path d={corners} />
      </svg>
    {/if}
    <span class="face" data-part="keycap.face">{@render children?.()}</span>
  </span>
{/if}

<style>
  .key {
    position: absolute;
    inset: 0;
    display: block;
  }
  .wall {
    position: absolute;
    inset: 0;
  }
  .wall.top {
    clip-path: polygon(0 0, 100% 0, calc(100% - var(--d)) var(--d), var(--d) var(--d));
  }
  .wall.left {
    clip-path: polygon(0 0, var(--d) var(--d), var(--d) calc(100% - var(--d)), 0 100%);
  }
  .wall.right {
    clip-path: polygon(
      100% 0,
      100% 100%,
      calc(100% - var(--d)) calc(100% - var(--d)),
      calc(100% - var(--d)) var(--d)
    );
  }
  .wall.bottom {
    clip-path: polygon(
      0 100%,
      var(--d) calc(100% - var(--d)),
      calc(100% - var(--d)) calc(100% - var(--d)),
      100% 100%
    );
  }
  .edges {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .face {
    position: absolute;
    inset: var(--d);
    display: block;
    overflow: hidden;
  }
</style>
