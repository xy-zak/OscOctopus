<script lang="ts">
  // 9×8 pixel-art octopus, drawn as crisp rects in the accent colour.
  const ART = [
    '..#####..',
    '.#######.',
    '##..#..##',
    '#########',
    '#########',
    '.#.#.#.#.',
    '#..#.#..#',
    '.#.....#.',
  ];
  const cells = ART.flatMap((row, y) =>
    [...row].map((c, x) => (c === '#' ? { x, y } : null)),
  ).filter((c): c is { x: number; y: number } => c !== null);
  let { size = 18 }: { size?: number } = $props();
</script>

<svg
  viewBox="0 0 9 8"
  width={size * 1.125}
  height={size}
  shape-rendering="crispEdges"
  aria-hidden="true"
>
  {#each cells as c (c.x + ',' + c.y)}<rect
      x={c.x}
      y={c.y}
      width="1"
      height="1"
      fill="var(--accent)"
    />{/each}
</svg>
