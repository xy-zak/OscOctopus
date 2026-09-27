<script lang="ts">
  import type { Preset } from '../model/preset';
  import { provideSkin } from '../skins/context';
  import { skinStore } from '../state/skins.svelte';
  import { viewsOf } from '../widgets/registry';
  import GridItem from './GridItem.svelte';
  import { colorVars } from '../theme/palettes';
  import { metrics as computeMetrics, toPx, type Rect } from './engine';

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
    /** Who else is editing a widget, if anyone (shared desks). */
    holderOf?: (id: string) => { name: string; color: string } | null;
  }
  let {
    preset,
    editing,
    locked = false,
    onlockedpress,
    holderOf,
    selectedId,
    focusedId = null,
    onselect,
    onfocus,
    oncommit,
  }: Props = $props();

  let width = $state(0);
  let height = $state(0);

  const grid = $derived(preset.grid);
  // Widgets whose colour is AUTO take the desk's own colour (see colorVars).
  const auto = $derived(colorVars(preset.color));
  // This desk's widgets wear its own skin, or the one for every desk.
  provideSkin(() => skinStore.forDesk(preset.id));
  const m = $derived(computeMetrics(width, height, grid, grid.gap));
  // The grid is drawn in edit mode only: live, the desk is just its widgets.
  const cells = $derived(
    editing
      ? Array.from({ length: grid.cols * grid.rows }, (_, i) =>
          toPx({ x: i % grid.cols, y: Math.floor(i / grid.cols), w: 1, h: 1 }, m),
        )
      : [],
  );
</script>

<div
  class="canvas"
  class:editing
  style:--auto-c={auto.c}
  style:--auto-ink={auto.ink}
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
      {@const Widget = viewsOf(w).component}
      <GridItem
        id={w.id}
        rect={{ x: w.x, y: w.y, w: w.w, h: w.h }}
        {grid}
        metrics={m}
        others={preset.widgets}
        {editing}
        selected={selectedId === w.id}
        focused={focusedId === w.id}
        holder={editing ? (holderOf?.(w.id) ?? null) : null}
        onselect={(id) => onselect(id)}
        {onfocus}
        {oncommit}
      >
        <!-- Not live while editing or LOCKED: widgets then ignore pointer and keyboard. -->
        <Widget widget={w} live={!editing && !locked} />
      </GridItem>
    {/each}
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
  /* Edit-mode cells: each one a faintly filled, outlined slot with its corners marked, tinted
     by the page (--grid-tint; the desk passes its own colour). Solid lines and a flat fill, so
     they never read as the dashed, dithered drop ghost. */
  .cell {
    position: absolute;
    top: 0;
    left: 0;
    --m: var(--grid-tint, var(--line-strong));
    border: 1px solid color-mix(in srgb, var(--m) 30%, transparent);
    background:
      linear-gradient(var(--m), var(--m)) top left / 8px 2px no-repeat,
      linear-gradient(var(--m), var(--m)) top left / 2px 8px no-repeat,
      linear-gradient(var(--m), var(--m)) top right / 8px 2px no-repeat,
      linear-gradient(var(--m), var(--m)) top right / 2px 8px no-repeat,
      linear-gradient(var(--m), var(--m)) bottom left / 8px 2px no-repeat,
      linear-gradient(var(--m), var(--m)) bottom left / 2px 8px no-repeat,
      linear-gradient(var(--m), var(--m)) bottom right / 8px 2px no-repeat,
      linear-gradient(var(--m), var(--m)) bottom right / 2px 8px no-repeat,
      color-mix(in srgb, var(--m) 7%, transparent);
    /* The corner marks sit on the outline, not inside it. */
    background-origin: border-box;
    pointer-events: none;
    animation: appear var(--t-release) steps(3, end);
  }
  @keyframes appear {
    from {
      opacity: 0;
    }
  }
</style>
