<script lang="ts">
  // One widget on the canvas. In edit mode it can be dragged (body) or resized (handles), with
  // the rest of the selection if it is selected. Dragged, it is carried by the desk's drag
  // (drag.svelte.ts): it follows the finger exactly, onto the desk or a frame's tab, while the
  // grid it would land on shows a snapped ghost. Resized, it shows its snapped size in place.
  // Invalid drops spring back.
  import { untrack, type Snippet } from 'svelte';
  import { tapHaptic } from '../platform/haptics';
  import { flag } from '../skins/anatomy';
  import * as touch from '../state/touch';
  import type { Holder } from './context';
  import type { DragSession, DragStart } from './drag.svelte';
  import { toPx, type Handle, type Metrics, type Rect } from './engine';

  interface Props {
    id: string;
    rect: Rect;
    metrics: Metrics;
    drag: DragSession;
    editing: boolean;
    selected: boolean;
    /** A frame: what it draws stays usable in edit mode (its tabs, and the widgets on them). */
    container?: boolean;
    /** Drawn over the other widgets of its grid (the frame holding the selected widgets). */
    raised?: boolean;
    /** Live mode: highlighted as the widget shown in the info panel. */
    focused?: boolean;
    /** Edit mode: someone else is editing this widget (a sync peer): shown, and not draggable. */
    holder?: Holder | null;
    /** A tap (a click, not a drag): picked alone, or with Shift (`add`) added or taken out. */
    onpick: (id: string, add: boolean) => void;
    /** Live mode: a pointer went down on this widget. */
    onfocus?: (id: string) => void;
    /** Past the tap slop: it starts being moved or resized (GridCanvas works out with what). */
    onlift: (kind: 'move' | Handle, start: DragStart) => void;
    children: Snippet;
  }
  let {
    id,
    rect,
    metrics,
    drag,
    editing,
    selected,
    container = false,
    raised = false,
    focused = false,
    holder = null,
    onpick,
    onfocus,
    onlift,
    children,
  }: Props = $props();

  const HANDLES: Handle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
  const TAP_SLOP = 5;
  const ZERO = { x: 0, y: 0 };

  interface Gesture {
    pointerId: number;
    kind: 'move' | Handle;
    x0: number;
    y0: number;
    add: boolean;
    moved: boolean;
  }
  let gesture = $state<Gesture | null>(null);

  const lifted = $derived(drag.carried.has(id));
  const moving = $derived(lifted && drag.lifted?.kind === 'move');
  // Resizing, it shows the size it would take; carried, it tracks the finger.
  const sized = $derived(lifted && !moving ? drag.drop?.rects.find((r) => r.id === id) : undefined);
  const box = $derived(toPx(sized ?? rect, metrics));
  const offset = $derived(moving ? drag.offset : ZERO);
  const invalid = $derived(lifted && drag.drop?.valid === false);

  function start(e: PointerEvent, kind: 'move' | Handle) {
    if (!editing || gesture) return;
    // Never the frame's around it, even while another widget is carried.
    e.stopPropagation();
    if (drag.lifted) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    gesture = {
      pointerId: e.pointerId,
      kind,
      x0: e.clientX,
      y0: e.clientY,
      add: e.shiftKey,
      moved: false,
    };
  }

  function move(e: PointerEvent) {
    // Once it moved, the drag follows the pointer.
    if (!gesture || e.pointerId !== gesture.pointerId || gesture.moved) return;
    // Someone else is editing it: a tap still selects it (to see who), a drag does nothing.
    if (holder) return;
    const { pointerId, kind, x0, y0, add } = gesture;
    if (Math.hypot(e.clientX - x0, e.clientY - y0) < TAP_SLOP) return;
    tapHaptic('light');
    gesture.moved = true;
    onlift(kind, { pointerId, x0, y0, x: e.clientX, y: e.clientY, add });
  }

  function end(e: PointerEvent) {
    if (!gesture || e.pointerId !== gesture.pointerId) return;
    if (!gesture.moved) onpick(id, gesture.add);
    gesture = null;
  }

  $effect(() => {
    if (!editing) untrack(() => (gesture = null));
  });
  // Gone while dragged (deleted, its frame deleted, another desk shown): the drag ends.
  $effect(() => {
    const me = id;
    return () => drag.forget(me);
  });
</script>

<div
  class="item"
  role="presentation"
  class:editing
  class:container
  class:selected
  class:raised
  class:focused={focused && !editing}
  class:lifted
  data-lifted={flag(lifted)}
  class:held={editing && !!holder}
  style:--holder={holder?.color}
  class:invalid
  style:transform="translate3d({box.left + offset.x}px, {box.top + offset.y}px, 0)"
  style:width="{box.width}px"
  style:height="{box.height}px"
  onpointerdown={(e) => start(e, 'move')}
  onpointerdowncapture={(e) => {
    if (editing) return;
    onfocus?.(id);
    // Local hands win: while this pointer is down, input and peers don't move the widget.
    touch.begin(id, e.pointerId);
  }}
  onpointermove={move}
  onpointerup={end}
  onpointercancel={() => (gesture = null)}
>
  <div class="content" inert={editing && !container}>
    {@render children()}
  </div>
  {#if editing && holder}
    <span class="holder" title="{holder.name} is editing this widget">✎ {holder.name}</span>
  {/if}
  {#if editing && selected}
    {#each HANDLES as h (h)}
      <!-- Move/up events bubble from the captured handle to the item's listeners. -->
      <div class="handle {h}" role="presentation" onpointerdown={(e) => start(e, h)}></div>
    {/each}
  {/if}
</div>

<style>
  .item {
    position: absolute;
    top: 0;
    left: 0;
    /* Settles into its cell after a drop; no transition while dragging. */
    transition:
      transform var(--t-release) var(--ease-spring),
      width var(--t-release) var(--ease-spring),
      height var(--t-release) var(--ease-spring);
    will-change: transform;
  }
  .item.editing {
    cursor: grab;
    touch-action: none;
  }
  /* A frame's tabs and the widgets on them stay usable; any other widget is only moved. */
  .item.editing:not(.container) .content {
    pointer-events: none;
  }
  /* Every item is a stacking context (its transform): a frame is raised for what is on it to
     show over the desk's other widgets. */
  .item.raised {
    z-index: 5;
  }
  /* A peer is editing it: outlined in their colour, with their name. */
  .item.held {
    cursor: not-allowed;
    outline: 2px dashed var(--holder);
    outline-offset: 2px;
  }
  .holder {
    position: absolute;
    top: -2px;
    left: -2px;
    max-width: 100%;
    padding: 0 0.5ch;
    overflow: hidden;
    background: var(--holder);
    color: var(--bg);
    font-weight: 700;
    white-space: nowrap;
    text-overflow: ellipsis;
    pointer-events: none;
  }
  /* Selection: marching ants. */
  .item.selected::after {
    content: '';
    position: absolute;
    inset: -5px;
    pointer-events: none;
    --a: var(--accent);
    background:
      repeating-linear-gradient(to right, var(--a) 0 4px, transparent 4px 8px) top left / 100% 1px
        repeat-x,
      repeating-linear-gradient(to right, var(--a) 0 4px, transparent 4px 8px) bottom left / 100%
        1px repeat-x,
      repeating-linear-gradient(to bottom, var(--a) 0 4px, transparent 4px 8px) top left / 1px 100%
        repeat-y,
      repeating-linear-gradient(to bottom, var(--a) 0 4px, transparent 4px 8px) top right / 1px 100%
        repeat-y;
    animation: ants 0.5s steps(4) infinite;
  }
  @keyframes ants {
    to {
      background-position:
        8px 0,
        -8px 100%,
        0 -8px,
        100% 8px;
    }
  }
  /* Live mode: brackets lock on around the widget shown in the info panel. */
  .item.focused::after {
    content: '';
    position: absolute;
    inset: -6px;
    pointer-events: none;
    --a: var(--accent);
    background:
      linear-gradient(var(--a), var(--a)) top left / 8px 2px no-repeat,
      linear-gradient(var(--a), var(--a)) top left / 2px 8px no-repeat,
      linear-gradient(var(--a), var(--a)) top right / 8px 2px no-repeat,
      linear-gradient(var(--a), var(--a)) top right / 2px 8px no-repeat,
      linear-gradient(var(--a), var(--a)) bottom left / 8px 2px no-repeat,
      linear-gradient(var(--a), var(--a)) bottom left / 2px 8px no-repeat,
      linear-gradient(var(--a), var(--a)) bottom right / 8px 2px no-repeat,
      linear-gradient(var(--a), var(--a)) bottom right / 2px 8px no-repeat;
    animation: lock-on var(--t-release) steps(3, end);
  }
  @keyframes lock-on {
    from {
      inset: -16px;
      opacity: 0;
    }
  }
  /* Reduced motion: the ants stand still and the brackets appear in place. */
  @media (prefers-reduced-motion: reduce) {
    .item.selected::after,
    .item.focused::after {
      animation: none;
    }
  }
  .item.lifted {
    transition: none;
    z-index: 10;
    cursor: grabbing;
    translate: -3px -3px;
  }
  .item.lifted.invalid {
    opacity: 0.75;
  }
  .content {
    width: 100%;
    height: 100%;
  }

  .handle {
    position: absolute;
    z-index: 2;
    touch-action: none;
  }
  /* Generous hit areas for fingers; the visible square is drawn with ::before. */
  .handle.n,
  .handle.s {
    left: 20%;
    right: 20%;
    height: 22px;
    cursor: ns-resize;
  }
  .handle.e,
  .handle.w {
    top: 20%;
    bottom: 20%;
    width: 22px;
    cursor: ew-resize;
  }
  .handle.n {
    top: -11px;
  }
  .handle.s {
    bottom: -11px;
  }
  .handle.e {
    right: -11px;
  }
  .handle.w {
    left: -11px;
  }
  .handle.ne,
  .handle.nw,
  .handle.se,
  .handle.sw {
    width: 28px;
    height: 28px;
  }
  .handle.ne {
    top: -14px;
    right: -14px;
    cursor: nesw-resize;
  }
  .handle.sw {
    bottom: -14px;
    left: -14px;
    cursor: nesw-resize;
  }
  .handle.nw {
    top: -14px;
    left: -14px;
    cursor: nwse-resize;
  }
  .handle.se {
    bottom: -14px;
    right: -14px;
    cursor: nwse-resize;
  }
  .handle::before {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    width: 8px;
    height: 8px;
    translate: -50% -50%;
    background: var(--accent);
    box-shadow: 0 0 0 1px var(--bg);
    transition: scale var(--t-release) steps(2, end);
  }
  .handle.n::before,
  .handle.s::before {
    width: 16px;
    height: 4px;
  }
  .handle.e::before,
  .handle.w::before {
    width: 4px;
    height: 16px;
  }
  .handle:hover::before,
  .handle:active::before {
    scale: 1.5;
  }
</style>
