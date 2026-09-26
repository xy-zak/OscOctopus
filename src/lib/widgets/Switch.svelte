<script lang="ts">
  // A slide switch in a frame: a solid block that sits on one half of a dithered track.
  // Tap to flip; or drag the block, which follows the finger and settles on the nearer side.
  import { clamp } from '../grid/engine';
  import type { SwitchWidget } from '../model/preset';
  import { emitValue } from '../osc/sender';
  import { tapHaptic, tickHaptic } from '../platform/haptics';
  import { numberValue } from '../state/values.svelte';
  import WidgetFrame from './WidgetFrame.svelte';

  let { widget, live }: { widget: SwitchWidget; live: boolean } = $props();

  const TAP_SLOP = 6;
  const p = $derived(widget.props);
  const value = $derived(numberValue(widget.id, p.offValue));
  const on = $derived(value === p.onValue && p.onValue !== p.offValue);

  let bw = $state(0);
  let bh = $state(0);
  const vertical = $derived(bh > bw * 1.15);
  const travel = $derived((vertical ? bh : bw) / 2);

  interface Drag {
    id: number;
    start: number;
    startPos: number;
    moved: boolean;
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
    drag = { id: e.pointerId, start: coord(e), startPos: on ? 1 : 0, moved: false };
    dragPos = drag.startPos;
    tapHaptic('light');
  }

  function onpointermove(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = coord(e) - drag.start;
    if (!drag.moved && Math.abs(d) < TAP_SLOP) return;
    drag.moved = true;
    const next = clamp(drag.startPos + d / (travel || 1), 0, 1);
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
  class="switch {live ? 'live' : ''}"
  title={widget.label}
  status={String(value)}
  color={widget.color}
  active={on}
  pressed={drag !== null}
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
      class:on
      class:vertical
      class:dragging={drag?.moved}
      style:--pos={pos}
      bind:clientWidth={bw}
      bind:clientHeight={bh}
    >
      <span class="legend off-legend"><span class="tag">OFF</span></span>
      <span class="legend on-legend"><span class="tag">ON</span></span>
      <span class="block"><span class="grip">{vertical ? '═' : '║'}</span></span>
    </div>
  {/snippet}
</WidgetFrame>

<style>
  :global(.frame.switch.live) {
    cursor: pointer;
  }
  .track {
    position: absolute;
    inset: 0;
    border: 1px solid var(--c);
    /* Dithered groove in the widget colour; ACTIVE green when on. */
    background: conic-gradient(at 2px 2px, transparent 75%, var(--c) 0) 0 0 / 4px 4px;
    transition: border-color var(--t-ui) steps(2);
  }
  .track.on {
    border-color: var(--act);
    background: conic-gradient(at 2px 2px, transparent 75%, var(--act) 0) 0 0 / 4px 4px;
  }
  .legend {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 50%;
    display: grid;
    place-items: center;
    font-weight: 700;
    transition: opacity var(--t-ui) steps(2);
  }
  /* A patch behind the word, so it reads on the coloured dots. */
  .tag {
    padding: 0 0.5ch;
    background: var(--w-bg);
  }
  .off-legend {
    right: 0;
    color: var(--c-text);
  }
  .on-legend {
    left: 0;
    color: var(--act);
    opacity: 0;
  }
  .on .off-legend {
    opacity: 0;
  }
  .on .on-legend {
    opacity: 1;
  }
  .vertical .legend {
    width: auto;
    height: 50%;
    left: 0;
    right: 0;
  }
  .vertical .off-legend {
    top: 0;
    bottom: auto;
  }
  .vertical .on-legend {
    top: auto;
    bottom: 0;
  }
  /* The block: slides with a spring when tapped, follows the finger while dragged. */
  .block {
    position: absolute;
    top: 2px;
    bottom: 2px;
    left: 2px;
    width: calc(50% - 4px);
    display: grid;
    place-items: center;
    background: var(--c-solid);
    color: var(--c-ink);
    box-shadow: 2px 2px 0 0 var(--shadow-px);
    transform: translateX(calc(var(--pos) * (100% + 4px)));
    transition:
      transform var(--t-release) var(--ease-spring),
      background var(--t-ui) steps(2);
    will-change: transform;
  }
  .on .block {
    background: var(--act);
    color: var(--act-ink);
  }
  .vertical .block {
    top: auto;
    left: 2px;
    right: 2px;
    bottom: 2px;
    width: auto;
    height: calc(50% - 4px);
    transform: translateY(calc(var(--pos) * -1 * (100% + 4px)));
  }
  .dragging .block {
    transition: background var(--t-ui) steps(2);
  }
  .grip {
    font-weight: 700;
  }
</style>
