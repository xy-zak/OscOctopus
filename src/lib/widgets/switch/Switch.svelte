<script lang="ts">
  // A slide switch in a frame: a thumb that sits at one end of a track (TERMINAL: a solid block
  // on one half of a dithered groove). Tap to flip; or drag the thumb, which follows the finger
  // and settles on the nearer side. The skin sizes the thumb (--switch-thumb-len), so the drag
  // travel is measured from it rather than assumed.
  import { clamp } from '../../util';
  import type { SwitchWidget } from '../../model/preset';
  import { emitValue } from '../../osc/flow';
  import { tapHaptic, tickHaptic } from '../../platform/haptics';
  import { flag } from '../../skins/anatomy';
  import { numberValue } from '../../state/values.svelte';
  import WidgetFrame from '../WidgetFrame.svelte';

  let { widget, live }: { widget: SwitchWidget; live: boolean } = $props();

  const TAP_SLOP = 6;
  const p = $derived(widget.props);
  const value = $derived(numberValue(widget.id, p.offValue));
  const on = $derived(value === p.onValue && p.onValue !== p.offValue);

  let bw = $state(0);
  let bh = $state(0);
  const vertical = $derived(bh > bw * 1.15);
  let thumb = $state<HTMLElement>();

  /** How far the thumb moves from off to on: the track less the thumb and its insets. */
  function travel(): number {
    if (!thumb) return (vertical ? bh : bw) / 2;
    const inset = thumb.offsetLeft;
    const t = vertical ? bh - thumb.offsetHeight : bw - thumb.offsetWidth;
    return Math.max(1, t - 2 * inset);
  }

  interface Drag {
    id: number;
    start: number;
    startPos: number;
    moved: boolean;
    travel: number;
  }
  let drag = $state<Drag | null>(null);
  let dragPos = $state(0);
  // Block position 0 (off) … 1 (on): follows the finger while dragging.
  const pos = $derived(drag?.moved ? dragPos : on ? 1 : 0);

  function set(next: boolean) {
    if (next === on) return;
    tapHaptic('medium');
    emitValue(widget.id, next ? p.onValue : p.offValue, true);
  }

  const coord = (e: PointerEvent) => (vertical ? -e.clientY : e.clientX);

  function onpointerdown(e: PointerEvent) {
    if (!live || drag) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = {
      id: e.pointerId,
      start: coord(e),
      startPos: on ? 1 : 0,
      moved: false,
      travel: travel(),
    };
    dragPos = drag.startPos;
    tapHaptic('light');
  }

  function onpointermove(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = coord(e) - drag.start;
    if (!drag.moved && Math.abs(d) < TAP_SLOP) return;
    drag.moved = true;
    const next = clamp(drag.startPos + d / drag.travel, 0, 1);
    if (next > 0.5 !== dragPos > 0.5) tickHaptic();
    dragPos = next;
  }

  function onpointerup(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    const { moved } = drag;
    drag = null;
    set(moved ? dragPos > 0.5 : !on);
  }

  function onkeydown(e: KeyboardEvent) {
    if (!live || e.repeat) return;
    if (e.key === ' ' || e.key === 'Enter') set(!on);
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') set(true);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') set(false);
    else return;
    e.preventDefault();
  }
</script>

<WidgetFrame
  {widget}
  {live}
  status={String(value)}
  active={on}
  pressed={drag !== null}
  data-on={flag(on)}
  data-vertical={flag(vertical)}
  data-dragging={flag(drag?.moved)}
  role="switch"
  aria-checked={on}
  aria-label={widget.label}
  tabindex={live ? 0 : -1}
  {onpointerdown}
  {onpointermove}
  {onpointerup}
  onpointercancel={onpointerup}
  {onkeydown}
>
  {#snippet children()}
    <div
      class="track"
      class:vertical
      data-part="switch.track"
      style:--pos={pos}
      bind:clientWidth={bw}
      bind:clientHeight={bh}
    >
      <span class="legend off" data-part="switch.legend" data-side="off"
        ><span class="tag" data-part="switch.tag">OFF</span></span
      >
      <span class="legend on" data-part="switch.legend" data-side="on"
        ><span class="tag" data-part="switch.tag">ON</span></span
      >
      <span class="thumb" data-part="switch.thumb" bind:this={thumb}
        ><span data-part="switch.grip">{vertical ? '═' : '║'}</span></span
      >
    </div>
  {/snippet}
</WidgetFrame>

<style>
  :global(.frame[data-type='switch'][data-live]) {
    cursor: pointer;
  }
  /* A size container, so the thumb's travel can be written in the track's own units. */
  .track {
    position: absolute;
    inset: 0;
    container-type: size;
  }
  .legend {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 50%;
    display: grid;
    place-items: center;
  }
  .tag {
    padding: 0 0.5ch;
  }
  .legend.off {
    right: 0;
  }
  .legend.on {
    left: 0;
  }
  .vertical .legend {
    width: auto;
    height: 50%;
    left: 0;
    right: 0;
  }
  .vertical .legend.off {
    top: 0;
    bottom: auto;
  }
  .vertical .legend.on {
    top: auto;
    bottom: 0;
  }
  /* The thumb starts at the off end, inset from the track, and travels --pos (0 … 1) of the
     way to the other end: the track less the thumb itself and both insets. */
  .thumb {
    --inset: var(--switch-inset, 2px);
    position: absolute;
    top: var(--inset);
    bottom: var(--inset);
    left: var(--inset);
    width: var(--switch-thumb-len, calc(50cqw - 2 * var(--inset)));
    display: grid;
    place-items: center;
    transform: translateX(calc(var(--pos) * (100cqw - 100% - 2 * var(--inset))));
    will-change: transform;
  }
  .vertical .thumb {
    top: auto;
    left: var(--inset);
    right: var(--inset);
    bottom: var(--inset);
    width: auto;
    height: var(--switch-thumb-len, calc(50cqh - 2 * var(--inset)));
    transform: translateY(calc(var(--pos) * -1 * (100cqh - 100% - 2 * var(--inset))));
  }
</style>
