<script lang="ts">
  // A key cap seen head-on, standing out of the panel towards you: the face is a smaller
  // rectangle in the middle, joined to the base by four corner edges and four walls. Light
  // comes from the top-left, so the walls are shaded with the Switch's groove dots: none on
  // top, sparse on the left, dense on the right and bottom. Pressed, the cap sinks back until
  // it is almost flush with the panel.
  //
  // Colours come from the caller through inherited custom properties, so a lit key only has
  // to set them: --key-edge (lines), --key-dots (wall shading), --key-face (face fill).
  import type { Snippet } from 'svelte';

  interface Props {
    /** Height of the cap in px at most; smaller keys stand out proportionally less. */
    depth?: number;
    down?: boolean;
    children?: Snippet;
  }
  let { depth = 12, down = false, children }: Props = $props();

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

<span class="key" class:down bind:clientWidth={w} bind:clientHeight={h} style:--d="{d}px">
  <span class="wall top" aria-hidden="true"></span>
  <span class="wall left" aria-hidden="true"></span>
  <span class="wall right" aria-hidden="true"></span>
  <span class="wall bottom" aria-hidden="true"></span>
  {#if w > 2 * d && h > 2 * d}
    <svg class="edges" width={w} height={h} aria-hidden="true" shape-rendering="crispEdges">
      <rect x="0.5" y="0.5" width={w - 1} height={h - 1} />
      <path d={corners} />
    </svg>
  {/if}
  <span class="face">{@render children?.()}</span>
</span>

<style>
  .key {
    --edge: var(--key-edge, var(--line-strong));
    --dots: var(--key-dots, var(--line));
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
    background: conic-gradient(at 2px 2px, transparent 75%, var(--dots) 0) 0 0 / 4px 4px;
  }
  .wall.right {
    clip-path: polygon(
      100% 0,
      100% 100%,
      calc(100% - var(--d)) calc(100% - var(--d)),
      calc(100% - var(--d)) var(--d)
    );
    background: repeating-conic-gradient(var(--dots) 0 25%, transparent 0 50%) 0 0 / 4px 4px;
  }
  .wall.bottom {
    clip-path: polygon(
      0 100%,
      var(--d) calc(100% - var(--d)),
      calc(100% - var(--d)) calc(100% - var(--d)),
      100% 100%
    );
    background: repeating-conic-gradient(var(--dots) 0 25%, transparent 0 50%) 0 0 / 4px 4px;
  }
  .edges {
    position: absolute;
    inset: 0;
    fill: none;
    stroke: var(--edge);
    pointer-events: none;
  }
  /* The face, with a raised bevel: a light line top-left, a dark one bottom-right. */
  .face {
    position: absolute;
    inset: var(--d);
    display: block;
    overflow: hidden;
    border: 1px solid var(--edge);
    background: var(--key-face, var(--bg-2));
    box-shadow:
      inset 1px 1px 0 0 color-mix(in srgb, var(--fg) 30%, transparent),
      inset -1px -1px 0 0 var(--shadow-px);
    transition: border-color var(--t-ui) steps(2);
  }
  .down .face {
    box-shadow: inset 1px 1px 0 0 var(--shadow-px);
  }
</style>
