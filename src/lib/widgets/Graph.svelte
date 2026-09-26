<script lang="ts">
  // XY pad drawn as a plot on dot-grid paper: one finger sets two channels at once. X and Y
  // each have their own range/step/curve (see Axis in model/preset.ts); messages pick a channel
  // per argument. The cursor is a pixel block with dashed crosshairs; while held, corner
  // brackets lock on around it, and it leaves a trail of fading pixels.
  import { clamp } from '../grid/engine';
  import type { GraphWidget } from '../model/preset';
  import {
    formatValue,
    initialValue,
    isRecord,
    sliderPosition,
    sliderValue,
    type XY,
  } from '../osc/mapping';
  import { emitValue } from '../osc/sender';
  import { tapHaptic } from '../platform/haptics';
  import { values } from '../state/values.svelte';
  import WidgetFrame from './WidgetFrame.svelte';

  let { widget, live }: { widget: GraphWidget; live: boolean } = $props();

  const TRAIL = 24;
  const p = $derived(widget.props);
  const value = $derived.by((): XY => {
    const v = values[widget.id];
    return isRecord(v) && typeof v.x === 'number' && typeof v.y === 'number'
      ? (v as XY)
      : (initialValue(widget) as XY);
  });
  // Normalised 0..1 position; y is 1 at the top.
  const nx = $derived(sliderPosition(value.x, p.x));
  const ny = $derived(sliderPosition(value.y, p.y));

  let plot = $state<HTMLDivElement>();
  interface Drag {
    id: number;
    rect: DOMRect;
    x0: number;
    y0: number;
    nx0: number;
    ny0: number;
  }
  let drag = $state<Drag | null>(null);
  let trail: { x: number; y: number; n: number }[] = $state.raw([]);
  let trailN = 0;
  let fading = $state(false);
  let fadeTimer: ReturnType<typeof setTimeout> | undefined;
  let lastTap = 0;

  function setPos(x: number, y: number, final = false) {
    const cx = clamp(x, 0, 1);
    const cy = clamp(y, 0, 1);
    const next = { x: sliderValue(cx, p.x), y: sliderValue(cy, p.y) };
    if (!final && next.x === value.x && next.y === value.y) return;
    emitValue(widget.id, next, final);
    if (p.trail) trail = [...trail.slice(-(TRAIL - 1)), { x: cx, y: cy, n: trailN++ }];
  }

  function fromPointer(e: PointerEvent, rect: DOMRect) {
    return [
      (e.clientX - rect.left) / rect.width,
      1 - (e.clientY - rect.top) / rect.height,
    ] as const;
  }

  function onpointerdown(e: PointerEvent) {
    if (!live || drag || !plot) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const rect = plot.getBoundingClientRect();
    tapHaptic('light');
    const now = performance.now();
    if (now - lastTap < 300) {
      lastTap = 0;
      emitValue(widget.id, initialValue(widget), true);
      return;
    }
    lastTap = now;
    clearTimeout(fadeTimer);
    fading = false;
    trail = [];
    drag = { id: e.pointerId, rect, x0: e.clientX, y0: e.clientY, nx0: nx, ny0: ny };
    if (p.touch === 'absolute') setPos(...fromPointer(e, rect));
  }

  function onpointermove(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    if (p.touch === 'absolute') {
      setPos(...fromPointer(e, drag.rect));
      return;
    }
    const fine = e.shiftKey ? 0.2 : 1;
    setPos(
      drag.nx0 + ((e.clientX - drag.x0) / drag.rect.width) * fine,
      drag.ny0 - ((e.clientY - drag.y0) / drag.rect.height) * fine,
    );
  }

  function onpointerup(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    emitValue(widget.id, { ...value }, true);
    // Let the trail dissolve rather than vanish.
    fading = true;
    fadeTimer = setTimeout(() => {
      trail = [];
      fading = false;
    }, 500);
  }

  function onkeydown(e: KeyboardEvent) {
    if (!live) return;
    const d = e.shiftKey ? 0.1 : 0.01;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-d, 0],
      ArrowRight: [d, 0],
      ArrowUp: [0, d],
      ArrowDown: [0, -d],
    };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    setPos(nx + m[0], ny + m[1], true);
  }

  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3));
</script>

<WidgetFrame
  class="graph {live ? 'live' : ''}"
  title={widget.label}
  status="{p.x.label}:{fmt(value.x)} {p.y.label}:{fmt(value.y)}"
  color={widget.color}
  active={drag !== null}
  role="slider"
  aria-label="{widget.label}: {p.x.label} and {p.y.label}"
  aria-valuetext={formatValue(value)}
  aria-valuenow={value.x}
  tabindex={live ? 0 : -1}
  {onpointerdown}
  {onpointermove}
  {onpointerup}
  onpointercancel={onpointerup}
  {onkeydown}
>
  {#snippet children()}
    <div
      bind:this={plot}
      class="plot"
      class:dragging={drag !== null}
      style:--nx={nx}
      style:--ny={ny}
    >
      <div class="grid"></div>
      <div class="trail" class:fading>
        {#each trail as t, i (t.n)}
          <span
            class="px"
            style:--tx={t.x}
            style:--ty={t.y}
            style:opacity={((i + 1) / trail.length) * 0.8}
          ></span>
        {/each}
      </div>
      <div class="cross-x"></div>
      <div class="cross-y"></div>
      <div class="cursor"><span class="lock"></span></div>
      <span class="tick x-min">{p.x.min}</span>
      <span class="tick x-max">{p.x.max}</span>
      <span class="tick y-max">{p.y.max}</span>
    </div>
  {/snippet}
</WidgetFrame>

<style>
  :global(.frame.graph.live) {
    cursor: crosshair;
  }
  /* Neutral paper with the grid printed in the widget colour. The cursor, its crosshairs and
     trail are the ACTIVE green. */
  .plot {
    --grid-line: color-mix(in srgb, var(--c) 45%, transparent);
    --paper: var(--bg-2);
    position: absolute;
    inset: 0;
    background: var(--paper);
    border: 1px solid var(--c);
    container-type: size;
    overflow: hidden;
  }
  /* Dot grid: a 1px dot every 10%, plus solid quarter lines. */
  .grid {
    position: absolute;
    inset: 0;
    background:
      conic-gradient(at 1px 1px, transparent 75%, var(--c) 0) 0 0 / 10% 10%,
      linear-gradient(to right, var(--grid-line) 1px, transparent 1px) 0 0 / 25% 100%,
      linear-gradient(to bottom, var(--grid-line) 1px, transparent 1px) 0 0 / 100% 25%;
    pointer-events: none;
  }
  .cross-x,
  .cross-y,
  .cursor,
  .px {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
    will-change: transform;
  }
  .cross-x,
  .cross-y,
  .cursor {
    transition: transform var(--t-release) var(--ease-out);
  }
  .dragging .cross-x,
  .dragging .cross-y,
  .dragging .cursor {
    transition: none;
  }
  /* Dashed crosshairs. */
  .cross-x {
    width: 100%;
    height: 1px;
    background: repeating-linear-gradient(to right, var(--act) 0 3px, transparent 3px 6px);
    transform: translateY(calc((1 - var(--ny)) * 100cqh));
  }
  .cross-y {
    width: 1px;
    height: 100%;
    background: repeating-linear-gradient(to bottom, var(--act) 0 3px, transparent 3px 6px);
    transform: translateX(calc(var(--nx) * 100cqw));
  }
  .cursor {
    width: 10px;
    height: 10px;
    margin: -5px 0 0 -5px;
    background: var(--act);
    box-shadow: 0 0 0 2px var(--bg);
    transform: translate(calc(var(--nx) * 100cqw), calc((1 - var(--ny)) * 100cqh));
  }
  /* Corner brackets that snap in around the cursor while it is held. */
  .lock {
    position: absolute;
    inset: 0;
    opacity: 0;
    --b: var(--fg);
    background:
      linear-gradient(var(--b), var(--b)) top left / 5px 1px no-repeat,
      linear-gradient(var(--b), var(--b)) top left / 1px 5px no-repeat,
      linear-gradient(var(--b), var(--b)) top right / 5px 1px no-repeat,
      linear-gradient(var(--b), var(--b)) top right / 1px 5px no-repeat,
      linear-gradient(var(--b), var(--b)) bottom left / 5px 1px no-repeat,
      linear-gradient(var(--b), var(--b)) bottom left / 1px 5px no-repeat,
      linear-gradient(var(--b), var(--b)) bottom right / 5px 1px no-repeat,
      linear-gradient(var(--b), var(--b)) bottom right / 1px 5px no-repeat;
    transition:
      inset var(--t-release) steps(3, end),
      opacity var(--t-press) steps(1);
  }
  .dragging .lock {
    inset: -8px;
    opacity: 1;
  }
  /* Trail: square pixels, older ones dimmer; dissolves in steps on release. */
  .trail {
    position: absolute;
    inset: 0;
    transition: opacity 450ms steps(4, end);
  }
  .trail.fading {
    opacity: 0;
  }
  .px {
    width: 4px;
    height: 4px;
    margin: -2px 0 0 -2px;
    background: var(--act);
    transform: translate(calc(var(--tx) * 100cqw), calc((1 - var(--ty)) * 100cqh));
  }
  .tick {
    position: absolute;
    padding: 0 0.5ch;
    color: var(--c-text);
    background: var(--paper);
    line-height: 1;
    pointer-events: none;
  }
  .x-min {
    left: 1px;
    bottom: 1px;
  }
  .x-max {
    right: 1px;
    bottom: 1px;
  }
  .y-max {
    left: 1px;
    top: 1px;
  }
</style>
