<script lang="ts">
  // A desk's grid of widgets, or one tab of a frame on it (`tab`). The desk's own canvas shares
  // the desk with the frames drawn on it (context.ts), which draw their shown tab with this same
  // canvas, nested, edited and played like the desk. One drag (drag.svelte.ts), made by the desk's
  // canvas, carries widgets between them. Frames sit on the desk only (model/tabs.ts), so this
  // nests once.
  import { untrack } from 'svelte';
  import type { Preset, TabRef, Widget } from '../model/preset';
  import {
    autoColorOn,
    canPlace,
    childrenIndex,
    gridOn,
    isTabs,
    placements,
    sameTab,
    tabKey,
  } from '../model/tabs';
  import { tickHaptic } from '../platform/haptics';
  import { provideSkin } from '../skins/context';
  import { lookStore } from '../state/look.svelte';
  import { colorVars } from '../theme/palettes';
  import { viewsOf } from '../widgets/registry';
  import { provideCanvas, type Holder } from './context';
  import { DragSession } from './drag.svelte';
  import { inBounds, metrics as computeMetrics, toPx, type Rect } from './engine';
  import GridItem from './GridItem.svelte';
  import TabCanvas from './TabCanvas.svelte';

  interface Props {
    preset: Preset;
    /** The frame tab shown (null: the desk itself). */
    tab?: TabRef | null;
    /** Where the desk's widgets show, from the desk's canvas (worked out here if none). */
    index?: Map<string, Widget[]>;
    /** The desk's drag, for a tab; the desk's own canvas makes it. */
    drag?: DragSession;
    editing: boolean;
    selectedId: string | null;
    focusedId?: string | null;
    onselect: (id: string | null) => void;
    onfocus?: (id: string) => void;
    /** A widget was put down at `rect` in the grid of `parent` (a tab; null: the desk). */
    oncommit: (id: string, rect: Rect, parent: TabRef | null) => void;
    /** LOCK: widgets render but ignore all input. */
    locked?: boolean;
    /** A press landed on the desk while locked (to hint how to unlock). */
    onlockedpress?: () => void;
    /** Who else is editing a widget, if anyone (shared desks). */
    holderOf?: (id: string) => Holder | null;
  }
  let {
    preset,
    tab = null,
    index: around,
    drag: given,
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

  let el = $state<HTMLDivElement>();
  let width = $state(0);
  let height = $state(0);

  /** The desk's own canvas, not a tab's. */
  const desk = !untrack(() => given);
  const drag =
    untrack(() => given) ??
    new DragSession({
      accepts: (id, at) => canPlace(preset, id, at),
      commit: (id, rect, at) => oncommit(id, rect, at),
      tick: tickHaptic,
    });

  const placed = $derived(placements(preset));
  const index = $derived(around ?? childrenIndex(preset, placed));
  const own = $derived(index.get(tabKey(tab)) ?? []);
  const grid = $derived(gridOn(preset, tab));
  // A tab draws what fits its grid (one outside it is "not shown", sync/conflicts.ts), and a
  // widget carried off its frame while the frame shows another tab, so that drag goes on. In desk
  // order, so the keyed each below never moves it.
  const widgets = $derived.by(() => {
    if (!tab) return own;
    const on = new Set(own);
    const carried = drag.lifted?.from?.widget === tab.widget ? drag.lifted.id : null;
    return preset.widgets.filter((w) => (on.has(w) && inBounds(w, grid)) || w.id === carried);
  });
  /** The frame the selected widget is on: drawn over the desk's other widgets, and so are its. */
  const raised = $derived(desk && selectedId ? placed.get(selectedId)?.widget : undefined);
  // Widgets whose colour is AUTO take the desk's own colour, or their frame's (colorVars).
  const auto = $derived(colorVars(autoColorOn(preset, tab)));
  const m = $derived(computeMetrics(width, height, grid, grid.gap));
  // The grid is drawn in edit mode only: live, the desk is just its widgets.
  const cells = $derived(
    editing
      ? Array.from({ length: grid.cols * grid.rows }, (_, i) =>
          toPx({ x: i % grid.cols, y: Math.floor(i / grid.cols), w: 1, h: 1 }, m),
        )
      : [],
  );
  // Where a carried widget would land, if on this grid.
  const ghost = $derived(
    drag.drop && sameTab(drag.drop.at, tab)
      ? { ...toPx(drag.drop.rect, m), valid: drag.drop.valid }
      : null,
  );

  // Editing, this grid is somewhere to put a carried widget.
  $effect(() => {
    if (!editing || !el) return;
    const element = el;
    return drag.register(() => ({ at: tab, element, grid, metrics: m, widgets: own }));
  });

  if (desk) {
    // This desk's widgets wear its look's skin (its colours are around it, App.svelte).
    provideSkin(() => lookStore.forDesk(preset.id).skin);
    provideCanvas(() => ({
      preset,
      index,
      editing,
      locked,
      selectedId,
      focusedId,
      onselect,
      onfocus,
      oncommit,
      holderOf,
      drag,
      Tab: TabCanvas,
    }));
    // Leaving EDIT (LOCK too) puts a carried widget back.
    $effect(() => {
      if (!editing) untrack(() => drag.cancel());
    });
  }
</script>

<div
  bind:this={el}
  class="canvas"
  class:desk
  class:editing
  style:--auto-c={auto.c}
  style:--auto-ink={auto.ink}
  bind:clientWidth={width}
  bind:clientHeight={height}
  role="presentation"
  class:locked
  onpointerdown={(e) => {
    // An empty press on a tab is its frame's (it selects or drags it), not the desk's.
    if (desk && editing && e.target === e.currentTarget) onselect(null);
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
    {#each widgets as w (w.id)}
      {@const Widget = viewsOf(w).component}
      <GridItem
        id={w.id}
        at={tab}
        rect={{ x: w.x, y: w.y, w: w.w, h: w.h }}
        {grid}
        metrics={m}
        others={own}
        {drag}
        {editing}
        container={isTabs(w)}
        raised={raised === w.id}
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

  {#if ghost}
    <!-- Where a carried widget would land: a dithered block, red if it would be refused. -->
    <div
      class="ghost"
      class:invalid={!ghost.valid}
      style:transform="translate3d({ghost.left}px, {ghost.top}px, 0)"
      style:width="{ghost.width}px"
      style:height="{ghost.height}px"
    ></div>
  {/if}
</div>

<style>
  .canvas {
    position: relative;
    width: 100%;
    height: 100%;
    touch-action: none;
  }
  /* The desk clips what is on it, and keeps its widgets' stacking to itself. A tab doesn't clip,
     so a widget carried off it, or the resize handles at the frame's edge, still show; what is
     outside a tab's grid isn't drawn at all. */
  .canvas.desk {
    overflow: hidden;
    isolation: isolate;
  }
  /* A tab's grid takes its frame's colour, as the desk's takes the desk's. */
  .canvas:not(.desk) {
    --grid-tint: var(--auto-c);
  }
  /* Edit-mode cells: each one a faintly filled, outlined slot with its corners marked, tinted
     by the grid's colour (--grid-tint; the desk passes its own). Solid lines and a flat fill, so
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
  /* Where a carried widget would land: over the widgets around it, under a raised frame and the
     carried widget itself. */
  .ghost {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 1;
    --g: var(--accent);
    border: 1px dashed var(--g);
    background: repeating-conic-gradient(
        color-mix(in srgb, var(--g) 35%, transparent) 0 25%,
        transparent 0 50%
      )
      0 0 / 4px 4px;
    transition:
      transform 80ms steps(2, end),
      width 80ms steps(2, end),
      height 80ms steps(2, end);
    pointer-events: none;
  }
  .ghost.invalid {
    --g: var(--danger);
  }
</style>
