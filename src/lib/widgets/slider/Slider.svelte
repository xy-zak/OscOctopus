<script lang="ts">
  // A fader: a narrow track that fills up to the value, and a cap wider than the track, like a
  // real fader knob, that tracks the exact value 1:1 under the finger, with a scale either side
  // of the track. TERMINAL draws it like the Switch: a dithered groove filling with ACTIVE
  // green dots and a solid cap.
  import type { SliderWidget } from '../../model/preset';
  import { sliderPosition, sliderValue } from '../../osc/curves';
  import { emitValue } from '../../osc/flow';
  import { tapHaptic, tickHaptic } from '../../platform/haptics';
  import { flag } from '../../skins/anatomy';
  import { numberValue } from '../../state/values.svelte';
  import { clamp } from '../../util';
  import { decimalsFor, doubleTap, dragScale, keyStep } from '../interaction';
  import WidgetFrame from '../WidgetFrame.svelte';

  let { widget, live }: { widget: SliderWidget; live: boolean } = $props();

  const p = $derived(widget.props);
  const vertical = $derived(p.orientation === 'vertical');
  const value = $derived(numberValue(widget.id, p.defaultValue));
  const pos = $derived(sliderPosition(value, p));
  const decimals = $derived(decimalsFor(p.step));

  /** The track: pointer positions are measured against it, so the cap centres on the finger. */
  let meter = $state<HTMLDivElement>();

  interface Drag {
    id: number;
    rect: DOMRect;
    startCoord: number;
    startPos: number;
  }
  let drag = $state<Drag | null>(null);
  const isDoubleTap = doubleTap();

  const coord = (e: PointerEvent) => (vertical ? e.clientY : e.clientX);

  function absolutePos(e: PointerEvent, rect: DOMRect) {
    return vertical
      ? 1 - (e.clientY - rect.top) / rect.height
      : (e.clientX - rect.left) / rect.width;
  }

  function setPos(n: number, final = false) {
    const v = sliderValue(clamp(n, 0, 1), p);
    if (v === value && !final) return;
    if (p.step > 0 && v !== value) tickHaptic();
    emitValue(widget.id, v, final);
  }

  function onpointerdown(e: PointerEvent) {
    if (!live || drag || !meter) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const rect = meter.getBoundingClientRect();
    tapHaptic('light');
    if (isDoubleTap()) {
      emitValue(widget.id, p.defaultValue, true);
      return;
    }
    drag = { id: e.pointerId, rect, startCoord: coord(e), startPos: pos };
    if (p.touch === 'absolute') setPos(absolutePos(e, rect));
  }

  function onpointermove(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    if (p.touch === 'absolute') {
      setPos(absolutePos(e, drag.rect));
      return;
    }
    const len = vertical ? drag.rect.height : drag.rect.width;
    const delta = ((coord(e) - drag.startCoord) / len) * dragScale(e);
    setPos(drag.startPos + (vertical ? -delta : delta));
  }

  function onpointerup(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    // Re-send the resting value unthrottled so the receiver always ends where the finger did.
    emitValue(widget.id, value, true);
  }

  function onkeydown(e: KeyboardEvent) {
    if (!live) return;
    const step = keyStep(p, e.shiftKey);
    const moves: Record<string, number> = {
      ArrowUp: step,
      ArrowRight: step,
      ArrowDown: -step,
      ArrowLeft: -step,
    };
    if (e.key in moves) setPos(pos + moves[e.key]!, true);
    else if (e.key === 'Home') setPos(0, true);
    else if (e.key === 'End') setPos(1, true);
    else return;
    e.preventDefault();
  }
</script>

<WidgetFrame
  type="slider"
  {live}
  title={widget.label}
  status={value.toFixed(decimals)}
  color={widget.color}
  active={drag !== null}
  data-vertical={flag(vertical)}
  data-dragging={flag(drag !== null)}
  role="slider"
  aria-label={widget.label}
  aria-orientation={p.orientation}
  aria-valuemin={Math.min(p.min, p.max)}
  aria-valuemax={Math.max(p.min, p.max)}
  aria-valuenow={value}
  tabindex={live ? 0 : -1}
  {onpointerdown}
  {onpointermove}
  {onpointerup}
  onpointercancel={onpointerup}
  {onkeydown}
>
  {#snippet children()}
    <div class="rail" class:vertical data-part="slider.rail" style:--pos={pos}>
      <div class="ticks" data-part="slider.ticks"></div>
      <div bind:this={meter} class="track" data-part="slider.track">
        <div class="fill" data-part="slider.fill"></div>
      </div>
      <div class="cap" data-part="slider.cap"><span data-part="slider.grip"></span></div>
    </div>
  {/snippet}
</WidgetFrame>

<style>
  :global(.frame[data-type='slider'][data-live]) {
    cursor: grab;
  }
  :global(.frame[data-type='slider'][data-dragging]) {
    cursor: grabbing;
  }
  /* --cap: cap thickness along the travel. The track is inset by half of it at each end, so
     the cap's centre line sits exactly on the edge of the fill. */
  .rail {
    --cap: var(--slider-cap-len, 10px);
    --track: var(--slider-track-w, clamp(8px, 34%, 26px));
    position: absolute;
    inset: 0;
    container-type: size;
  }
  .track {
    position: absolute;
    left: calc(var(--cap) / 2);
    right: calc(var(--cap) / 2);
    top: 50%;
    height: var(--track);
    translate: 0 -50%;
  }
  .vertical .track {
    left: 50%;
    right: auto;
    top: calc(var(--cap) / 2);
    bottom: calc(var(--cap) / 2);
    width: var(--track);
    height: auto;
    translate: -50% 0;
  }
  /* The fill, revealed up to the value. */
  .fill {
    position: absolute;
    inset: 0;
    clip-path: inset(0 calc((1 - var(--pos)) * 100%) 0 0);
  }
  .vertical .fill {
    clip-path: inset(calc((1 - var(--pos)) * 100%) 0 0 0);
  }
  .ticks {
    position: absolute;
    top: 0;
    bottom: 0;
    left: calc(var(--cap) / 2);
    right: calc(var(--cap) / 2);
    pointer-events: none;
  }
  .vertical .ticks {
    top: calc(var(--cap) / 2);
    bottom: calc(var(--cap) / 2);
    left: 0;
    right: 0;
  }
  /* The cap, across the full width of the rail. */
  .cap {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: var(--cap);
    display: grid;
    place-items: center;
    transform: translateX(calc(var(--pos) * (100cqw - var(--cap))));
    will-change: transform;
  }
  .vertical .cap {
    top: auto;
    right: 0;
    width: auto;
    height: var(--cap);
    transform: translateY(calc(var(--pos) * -1 * (100cqh - var(--cap))));
  }
</style>
