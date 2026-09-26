<script lang="ts">
  // A curved fader: the fader's segments, cap line and quarter ticks bent round an arc and
  // drawn on a pixel grid (ring.ts). Nothing in the middle.
  //   bounded: a 270° arc with a range. Drag up/down (Shift = fine), double-tap resets.
  //            Value: a number.
  //   endless: an encoder on a full ring. Every `detentPx` of drag is one detent: it sends
  //            {value, delta} with delta = ±deltaStep. A short trail shows the direction.
  import type { KnobWidget } from '../../model/preset';
  import { sliderPosition, sliderValue } from '../../osc/curves';
  import { emitValue } from '../../osc/sender';
  import { isRecord } from '../../osc/value';
  import { tapHaptic, tickHaptic } from '../../platform/haptics';
  import { values } from '../../state/values.svelte';
  import { clamp } from '../../util';
  import { decimalsFor, decimalsOf, doubleTap, dragScale, keyStep } from '../interaction';
  import WidgetFrame from '../WidgetFrame.svelte';
  import { buildRing, capPaths } from './ring';

  let { widget, live }: { widget: KnobWidget; live: boolean } = $props();

  /** Detents per lap of the endless ring. */
  const LAP = 32;
  /** px of vertical drag for the full range of a bounded knob. */
  const RANGE_PX = 220;

  const p = $derived(widget.props);
  const endless = $derived(p.mode === 'endless');
  const raw = $derived(values[widget.id]);
  const value = $derived(
    isRecord(raw) && typeof raw.value === 'number'
      ? raw.value
      : typeof raw === 'number'
        ? raw
        : p.defaultValue,
  );
  const lastDelta = $derived(isRecord(raw) && typeof raw.delta === 'number' ? raw.delta : 0);

  // 0..1 along the ring. Endless wraps: one lap every LAP detents.
  const pos = $derived.by(() => {
    if (!endless) return sliderPosition(value, p);
    const lap = p.deltaStep * LAP;
    return ((((value - p.defaultValue) / lap) % 1) + 1) % 1;
  });

  let bw = $state(0);
  let bh = $state(0);
  const ring = $derived(bw && bh ? buildRing(bw, bh, endless ? 360 : 270) : null);
  const cap = $derived(ring ? capPaths(ring, pos) : null);
  /** Segment paths by role: lit, the endless trail (3 fading steps), and unlit. */
  const paths = $derived.by(() => {
    const out = { lit: '', t1: '', t2: '', t3: '', unlit: '' };
    if (!ring) return out;
    const n = ring.nSeg;
    if (!endless) {
      const litCount = Math.round(pos * n);
      ring.segPaths.forEach((d, i) => (i < litCount ? (out.lit += d) : (out.unlit += d)));
      return out;
    }
    const cur = Math.min(n - 1, Math.floor(pos * n));
    const back = lastDelta < 0 ? 1 : -1; // the trail lies behind the direction of travel
    const trail = new Map([1, 2, 3].map((k) => [(((cur + back * k) % n) + n) % n, k]));
    ring.segPaths.forEach((d, i) => {
      if (i === cur) out.lit += d;
      else if (trail.has(i)) out[`t${trail.get(i) as 1 | 2 | 3}`] += d;
      else out.unlit += d;
    });
    return out;
  });
  const decimals = $derived(
    endless
      ? // Enough for both the step and the value itself (it may start off the step grid).
        Math.max(decimalsOf(p.deltaStep), decimalsOf(value))
      : decimalsFor(p.step),
  );

  let drag = $state<{ id: number; y0: number; pos0: number; acc: number } | null>(null);
  let flash = $state(0);
  const isDoubleTap = doubleTap();

  function setPos(n: number, final = false) {
    const v = sliderValue(clamp(n, 0, 1), p);
    if (v === value && !final) return;
    if (p.step > 0 && v !== value) tickHaptic();
    emitValue(widget.id, v, final);
  }

  function turn(detents: number) {
    if (detents === 0) return;
    const delta = Number((detents * p.deltaStep).toFixed(10));
    const next = Number((value + delta).toFixed(10));
    tickHaptic();
    flash++;
    emitValue(widget.id, { value: next, delta });
  }

  function onpointerdown(e: PointerEvent) {
    if (!live || drag) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    tapHaptic('light');
    if (isDoubleTap()) {
      emitValue(widget.id, endless ? { value: p.defaultValue, delta: 0 } : p.defaultValue, true);
      return;
    }
    drag = { id: e.pointerId, y0: e.clientY, pos0: pos, acc: 0 };
  }

  function onpointermove(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = (drag.y0 - e.clientY) * dragScale(e); // up = more
    if (!endless) {
      setPos(drag.pos0 + dy / RANGE_PX);
      return;
    }
    // Endless: count whole detents crossed since the last one.
    const detents = Math.trunc((dy - drag.acc) / p.detentPx);
    if (detents !== 0) {
      drag.acc += detents * p.detentPx;
      turn(detents);
    }
  }

  function onpointerup(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    if (!endless) emitValue(widget.id, value, true);
  }

  function onkeydown(e: KeyboardEvent) {
    if (!live) return;
    const dir =
      e.key === 'ArrowUp' || e.key === 'ArrowRight'
        ? 1
        : e.key === 'ArrowDown' || e.key === 'ArrowLeft'
          ? -1
          : 0;
    if (!dir) return;
    e.preventDefault();
    if (endless) turn(dir * (e.shiftKey ? 10 : 1));
    else setPos(pos + dir * keyStep(p, e.shiftKey), true);
  }
</script>

<WidgetFrame
  class="knob {live ? 'live' : ''}"
  title={widget.label}
  status={value.toFixed(decimals)}
  color={widget.color}
  active={drag !== null}
  role="slider"
  aria-label={widget.label}
  aria-valuenow={value}
  tabindex={live ? 0 : -1}
  {onpointerdown}
  {onpointermove}
  {onpointerup}
  onpointercancel={onpointerup}
  {onkeydown}
>
  {#snippet children()}
    <div class="dial" bind:clientWidth={bw} bind:clientHeight={bh}>
      {#if ring && cap}
        <svg
          width={bw}
          height={bh}
          viewBox="0 0 {bw} {bh}"
          shape-rendering="crispEdges"
          aria-hidden="true"
        >
          <path class="unlit" d={paths.unlit} />
          <path class="lit" d={paths.lit} />
          <path class="lit t1" d={paths.t1} />
          <path class="lit t2" d={paths.t2} />
          <path class="lit t3" d={paths.t3} />
          <path class="ticks" d={ring.tickPath} />
          <path class="outline" d={cap.outline} />
          <path class="cap" d={cap.cap} />
        </svg>
      {/if}
    </div>
    {#if endless}
      {#key flash}
        <span class="delta" class:show={flash > 0}
          >{lastDelta > 0 ? '+' : ''}{lastDelta.toFixed(decimals)}</span
        >
      {/key}
    {/if}
  {/snippet}
</WidgetFrame>

<style>
  :global(.frame.knob.live) {
    cursor: ns-resize;
  }
  .dial {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }
  .dial svg {
    display: block;
  }
  /* The arc rests in the widget colour (dimmed so the value reads); the value is ACTIVE green. */
  .unlit {
    fill: color-mix(in srgb, var(--c) 55%, transparent);
  }
  .lit {
    fill: var(--act);
  }
  /* The endless trail fades in whole steps, not a gradient. */
  .t1 {
    opacity: 0.6;
  }
  .t2 {
    opacity: 0.35;
  }
  .t3 {
    opacity: 0.15;
  }
  .ticks {
    fill: var(--fg-faint);
  }
  .outline {
    fill: var(--bg);
  }
  .cap {
    fill: var(--fg);
  }
  /* The last encoder step, flashing in the centre and fading in pixel steps. */
  .delta {
    position: absolute;
    left: 50%;
    top: 50%;
    translate: -50% -50%;
    font-weight: 700;
    color: var(--act);
    opacity: 0;
    pointer-events: none;
  }
  .delta.show {
    animation: fade 700ms steps(4, end) forwards;
  }
  @keyframes fade {
    0% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }
</style>
