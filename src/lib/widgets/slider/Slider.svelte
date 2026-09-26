<script lang="ts">
  // A fader, built like the Switch: a narrow dithered track in the widget colour that fills
  // with ACTIVE green dots, and a solid cap wider than the track, like a real fader knob, that
  // tracks the exact value 1:1 under the finger. Scale marks sit either side of the track.
  import type { SliderWidget } from '../../model/preset';
  import { sliderPosition, sliderValue } from '../../osc/curves';
  import { emitValue } from '../../osc/sender';
  import { tapHaptic, tickHaptic } from '../../platform/haptics';
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
  class="slider {live ? 'live' : ''} {drag ? 'dragging' : ''}"
  title={widget.label}
  status={value.toFixed(decimals)}
  color={widget.color}
  active={drag !== null}
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
    <div class="rail" class:vertical class:dragging={drag !== null} style:--pos={pos}>
      <div class="ticks"></div>
      <div bind:this={meter} class="track">
        <div class="lit"></div>
      </div>
      <div class="cap"><span class="grip"></span></div>
    </div>
  {/snippet}
</WidgetFrame>

<style>
  :global(.frame.slider.live) {
    cursor: grab;
  }
  :global(.frame.slider.dragging) {
    cursor: grabbing;
  }
  /* --cap: cap thickness along the travel. The track is inset by half of it at each end, so
     the cap's centre line sits exactly on the edge of the fill. */
  .rail {
    --cap: 10px;
    --track: clamp(8px, 34%, 26px);
    position: absolute;
    inset: 0;
    container-type: size;
  }
  /* The Switch's groove, in the widget colour: a 25% dither. */
  .track {
    position: absolute;
    left: calc(var(--cap) / 2);
    right: calc(var(--cap) / 2);
    top: 50%;
    height: var(--track);
    translate: 0 -50%;
    border: 1px solid var(--c);
    background: var(--dither-25-c);
    transition: border-color var(--t-ui) steps(2);
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
  .dragging .track {
    border-color: var(--act);
  }
  /* The fill: ACTIVE green dots, denser than the groove's, revealed up to the value. It has its
     own backing so the groove's dots don't show through. */
  .lit {
    position: absolute;
    inset: 0;
    background: var(--dither-50-act), var(--w-bg);
    clip-path: inset(0 calc((1 - var(--pos)) * 100%) 0 0);
    transition: clip-path var(--t-release) var(--ease-out);
  }
  .vertical .lit {
    clip-path: inset(calc((1 - var(--pos)) * 100%) 0 0 0);
  }
  .dragging .lit {
    transition: none;
  }
  /* Printed scale either side of the track: ends and middle long, quarters short. */
  .ticks {
    --t: var(--fg-faint);
    position: absolute;
    top: 0;
    bottom: 0;
    left: calc(var(--cap) / 2);
    right: calc(var(--cap) / 2);
    background:
      linear-gradient(var(--t), var(--t)) 0% 0 / 1px 6px no-repeat,
      linear-gradient(var(--t), var(--t)) 25% 0 / 1px 3px no-repeat,
      linear-gradient(var(--t), var(--t)) 50% 0 / 1px 6px no-repeat,
      linear-gradient(var(--t), var(--t)) 75% 0 / 1px 3px no-repeat,
      linear-gradient(var(--t), var(--t)) 100% 0 / 1px 6px no-repeat,
      linear-gradient(var(--t), var(--t)) 0% 100% / 1px 6px no-repeat,
      linear-gradient(var(--t), var(--t)) 25% 100% / 1px 3px no-repeat,
      linear-gradient(var(--t), var(--t)) 50% 100% / 1px 6px no-repeat,
      linear-gradient(var(--t), var(--t)) 75% 100% / 1px 3px no-repeat,
      linear-gradient(var(--t), var(--t)) 100% 100% / 1px 6px no-repeat;
    pointer-events: none;
  }
  .vertical .ticks {
    top: calc(var(--cap) / 2);
    bottom: calc(var(--cap) / 2);
    left: 0;
    right: 0;
    background:
      linear-gradient(var(--t), var(--t)) 0 0% / 6px 1px no-repeat,
      linear-gradient(var(--t), var(--t)) 0 25% / 3px 1px no-repeat,
      linear-gradient(var(--t), var(--t)) 0 50% / 6px 1px no-repeat,
      linear-gradient(var(--t), var(--t)) 0 75% / 3px 1px no-repeat,
      linear-gradient(var(--t), var(--t)) 0 100% / 6px 1px no-repeat,
      linear-gradient(var(--t), var(--t)) 100% 0% / 6px 1px no-repeat,
      linear-gradient(var(--t), var(--t)) 100% 25% / 3px 1px no-repeat,
      linear-gradient(var(--t), var(--t)) 100% 50% / 6px 1px no-repeat,
      linear-gradient(var(--t), var(--t)) 100% 75% / 3px 1px no-repeat,
      linear-gradient(var(--t), var(--t)) 100% 100% / 6px 1px no-repeat;
  }
  /* The cap: a solid block in the widget colour across the full width, like the Switch's block,
     with a grip line. Green while held. */
  .cap {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: var(--cap);
    display: grid;
    place-items: center;
    background: var(--c-solid);
    box-shadow: 2px 2px 0 0 var(--shadow-px);
    transform: translateX(calc(var(--pos) * (100cqw - var(--cap))));
    transition:
      transform var(--t-release) var(--ease-out),
      background var(--t-ui) steps(2);
    will-change: transform;
  }
  .vertical .cap {
    top: auto;
    right: 0;
    width: auto;
    height: var(--cap);
    transform: translateY(calc(var(--pos) * -1 * (100cqh - var(--cap))));
  }
  .dragging .cap {
    background: var(--act);
    transition: background var(--t-ui) steps(2);
  }
  .grip {
    width: 1px;
    height: 60%;
    background: var(--c-ink);
  }
  .dragging .grip {
    background: var(--act-ink);
  }
  .vertical .grip {
    width: 60%;
    height: 1px;
  }
</style>
