<script lang="ts">
  // XY pad drawn as a plot on grid paper: one finger sets two channels at once. X and Y each
  // have their own range/step/curve (see Axis in model/preset.ts); messages pick a channel per
  // argument. A cursor with crosshairs; while held, brackets lock on around it and it leaves a
  // trail of fading dots (TERMINAL: dashed lines and square pixels on a dot grid).
  import type { GraphWidget } from '../../model/preset';
  import { sliderPosition, sliderValue } from '../../osc/curves';
  import { formatValue } from '../../osc/format';
  import { emitValue } from '../../osc/flow';
  import { isRecord, type XY } from '../../osc/value';
  import { tapHaptic } from '../../platform/haptics';
  import { flag } from '../../skins/anatomy';
  import { values } from '../../state/values.svelte';
  import { clamp } from '../../util';
  import { doubleTap, dragScale, keyStep } from '../interaction';
  import WidgetFrame from '../WidgetFrame.svelte';
  import { graphDef } from './def';

  let { widget, live }: { widget: GraphWidget; live: boolean } = $props();

  const TRAIL = 24;
  const p = $derived(widget.props);
  const home = $derived(graphDef.initialValue(widget) as XY);
  const value = $derived.by((): XY => {
    const v = values[widget.id];
    return isRecord(v) && typeof v.x === 'number' && typeof v.y === 'number' ? (v as XY) : home;
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
  const isDoubleTap = doubleTap();

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
    if (isDoubleTap()) {
      emitValue(widget.id, home, true);
      return;
    }
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
    const scale = dragScale(e);
    setPos(
      drag.nx0 + ((e.clientX - drag.x0) / drag.rect.width) * scale,
      drag.ny0 - ((e.clientY - drag.y0) / drag.rect.height) * scale,
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
    const dx = keyStep(p.x, e.shiftKey);
    const dy = keyStep(p.y, e.shiftKey);
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-dx, 0],
      ArrowRight: [dx, 0],
      ArrowUp: [0, dy],
      ArrowDown: [0, -dy],
    };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    setPos(nx + m[0], ny + m[1], true);
  }

  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3));
</script>

<WidgetFrame
  {widget}
  {live}
  data-dragging={flag(drag !== null)}
  status="{p.x.label}:{fmt(value.x)} {p.y.label}:{fmt(value.y)}"
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
    <div bind:this={plot} class="plot" data-part="graph.plot" style:--nx={nx} style:--ny={ny}>
      <div class="grid" data-part="graph.grid"></div>
      <div class="trail" data-part="graph.trail" data-fading={flag(fading)}>
        {#each trail as t, i (t.n)}
          <span
            class="px"
            data-part="graph.dot"
            style:--tx={t.x}
            style:--ty={t.y}
            style:opacity={((i + 1) / trail.length) * 0.8}
          ></span>
        {/each}
      </div>
      <div class="cross-x" data-part="graph.cross" data-axis="x"></div>
      <div class="cross-y" data-part="graph.cross" data-axis="y"></div>
      <div class="cursor" data-part="graph.cursor">
        <span class="lock" data-part="graph.lock"></span>
      </div>
      <span class="tick x-min" data-part="graph.tick" data-at="x-min">{p.x.min}</span>
      <span class="tick x-max" data-part="graph.tick" data-at="x-max">{p.x.max}</span>
      <span class="tick y-max" data-part="graph.tick" data-at="y-max">{p.y.max}</span>
    </div>
  {/snippet}
</WidgetFrame>

<style>
  :global(.frame[data-type='graph'][data-live]) {
    cursor: crosshair;
  }
  .plot {
    position: absolute;
    inset: 0;
    container-type: size;
    overflow: hidden;
  }
  .grid {
    position: absolute;
    inset: 0;
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
  .cross-x {
    width: 100%;
    height: 1px;
    transform: translateY(calc((1 - var(--ny)) * 100cqh));
  }
  .cross-y {
    width: 1px;
    height: 100%;
    transform: translateX(calc(var(--nx) * 100cqw));
  }
  .cursor {
    --size: var(--graph-cursor, 10px);
    width: var(--size);
    height: var(--size);
    margin: calc(var(--size) / -2) 0 0 calc(var(--size) / -2);
    transform: translate(calc(var(--nx) * 100cqw), calc((1 - var(--ny)) * 100cqh));
  }
  /* Brackets around the cursor; the skin moves them in and out (--graph-lock-inset). */
  .lock {
    position: absolute;
    inset: var(--graph-lock-inset, 0px);
  }
  .trail {
    position: absolute;
    inset: 0;
  }
  .px {
    --size: var(--graph-dot, 4px);
    width: var(--size);
    height: var(--size);
    margin: calc(var(--size) / -2) 0 0 calc(var(--size) / -2);
    transform: translate(calc(var(--tx) * 100cqw), calc((1 - var(--ty)) * 100cqh));
  }
  .tick {
    position: absolute;
    padding: 0 0.5ch;
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
