<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Preset } from '../model/preset';
  import { componentFor } from '../widgets/registry';
  import GridItem from './GridItem.svelte';
  import { metrics as computeMetrics, editCell, toPx, withEditCell, type Rect } from './engine';

  interface Props {
    preset: Preset;
    editing: boolean;
    selectedId: string | null;
    focusedId?: string | null;
    onselect: (id: string | null) => void;
    onfocus?: (id: string) => void;
    oncommit: (id: string, rect: Rect) => void;
    /** LOCK: widgets render but ignore all input. */
    locked?: boolean;
    /** A press landed on the desk while locked (to hint how to unlock). */
    onlockedpress?: () => void;
    /** Rendered in the reserved top-right cells (the EDIT / LIVE switch). */
    editControl?: Snippet;
  }
  let {
    preset,
    editing,
    locked = false,
    onlockedpress,
    editControl,
    selectedId,
    focusedId = null,
    onselect,
    onfocus,
    oncommit,
  }: Props = $props();

  let width = $state(0);
  let height = $state(0);

  const grid = $derived(preset.grid);
  const m = $derived(computeMetrics(width, height, grid, grid.gap));
  const cells = $derived(
    editing
      ? Array.from({ length: grid.cols * grid.rows }, (_, i) =>
          toPx({ x: i % grid.cols, y: Math.floor(i / grid.cols), w: 1, h: 1 }, m),
        )
      : [],
  );
  // Widgets can't be dropped onto the reserved cell any more than onto each other.
  const occupied = $derived(withEditCell(preset.widgets, grid));
  const editBox = $derived(toPx(editCell(grid), m));

  // Backdrop, locked to the grid: a cross on every gutter crossing, and small dots that divide
  // each cell pitch evenly (about 20px apart), so every dot lines up with the cells.
  const pid = $props.id();
  const pitchX = $derived(m.cellW + m.gap);
  const pitchY = $derived(m.cellH + m.gap);
  const dotX = $derived(pitchX / Math.max(1, Math.round(pitchX / 20)));
  const dotY = $derived(pitchY / Math.max(1, Math.round(pitchY / 20)));
  const ARM = 4;
</script>

<div
  class="canvas"
  class:editing
  bind:clientWidth={width}
  bind:clientHeight={height}
  role="presentation"
  class:locked
  onpointerdown={(e) => {
    if (editing && e.target === e.currentTarget) onselect(null);
  }}
  onpointerdowncapture={() => {
    if (locked) onlockedpress?.();
  }}
>
  <!-- Live only: while editing, the placement marks below are the only thing on the canvas. -->
  {#if !editing && width > 0 && pitchX > 0 && pitchY > 0}
    <svg class="backdrop" {width} {height} aria-hidden="true">
      <defs>
        <!-- Each pattern tile is centred on a grid point, so nothing is clipped at tile edges. -->
        <pattern
          id="{pid}-dots"
          patternUnits="userSpaceOnUse"
          x={m.gap / 2 - dotX / 2}
          y={m.gap / 2 - dotY / 2}
          width={dotX}
          height={dotY}
        >
          <circle cx={dotX / 2} cy={dotY / 2} r="0.8" fill="currentColor" />
        </pattern>
        <pattern
          id="{pid}-marks"
          patternUnits="userSpaceOnUse"
          x={m.gap / 2 - pitchX / 2}
          y={m.gap / 2 - pitchY / 2}
          width={pitchX}
          height={pitchY}
        >
          <path
            d="M{pitchX / 2 - ARM} {pitchY / 2}h{ARM * 2}M{pitchX / 2} {pitchY / 2 - ARM}v{ARM * 2}"
            stroke="currentColor"
          />
        </pattern>
      </defs>
      <rect class="dots" width="100%" height="100%" fill="url(#{pid}-dots)" />
      <rect class="marks" width="100%" height="100%" fill="url(#{pid}-marks)" />
    </svg>
  {/if}

  {#each cells as c, i (i)}
    <div
      class="cell"
      style:transform="translate({c.left}px, {c.top}px)"
      style:width="{c.width}px"
      style:height="{c.height}px"
    ></div>
  {/each}

  {#if width > 0}
    {#each preset.widgets as w (w.id)}
      {@const Widget = componentFor(w)}
      <GridItem
        id={w.id}
        rect={{ x: w.x, y: w.y, w: w.w, h: w.h }}
        {grid}
        metrics={m}
        others={occupied}
        {editing}
        selected={selectedId === w.id}
        focused={focusedId === w.id}
        onselect={(id) => onselect(id)}
        {onfocus}
        {oncommit}
      >
        <!-- Not live while editing or LOCKED: widgets then ignore pointer and keyboard. -->
        <Widget widget={w} live={!editing && !locked} />
      </GridItem>
    {/each}
    {#if editControl}
      <div
        class="edit-cell"
        style:transform="translate({editBox.left}px, {editBox.top}px)"
        style:width="{editBox.width}px"
        style:height="{editBox.height}px"
      >
        {@render editControl()}
      </div>
    {/if}
  {/if}
</div>

<style>
  .canvas {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    touch-action: none;
  }
  /* Tinted by the page (--grid-tint); the desk passes its own colour. */
  .backdrop {
    position: absolute;
    top: 0;
    left: 0;
    color: var(--grid-tint, var(--line-strong));
    pointer-events: none;
  }
  .dots {
    opacity: 0.35;
  }
  .marks {
    opacity: 0.7;
  }
  /* Edit-mode cells: just their corners, like registration marks. */
  .cell {
    position: absolute;
    top: 0;
    left: 0;
    --m: var(--line-strong);
    background:
      linear-gradient(var(--m), var(--m)) top left / 5px 1px no-repeat,
      linear-gradient(var(--m), var(--m)) top left / 1px 5px no-repeat,
      linear-gradient(var(--m), var(--m)) top right / 5px 1px no-repeat,
      linear-gradient(var(--m), var(--m)) top right / 1px 5px no-repeat,
      linear-gradient(var(--m), var(--m)) bottom left / 5px 1px no-repeat,
      linear-gradient(var(--m), var(--m)) bottom left / 1px 5px no-repeat,
      linear-gradient(var(--m), var(--m)) bottom right / 5px 1px no-repeat,
      linear-gradient(var(--m), var(--m)) bottom right / 1px 5px no-repeat;
    pointer-events: none;
    animation: appear var(--t-release) steps(3, end);
  }
  .edit-cell {
    position: absolute;
    top: 0;
    left: 0;
    /* Above a dragged widget's ghost, below a lifted widget (z-index 10). */
    z-index: 5;
  }
  @keyframes appear {
    from {
      opacity: 0;
    }
  }
</style>
