<script lang="ts">
  // A grid of numbered pads: 1…rows×cols in reading order (top-left = 1). Every hit sends
  //   {number, row, col, on}     (row and col count from 1 at the top-left)
  // through the ordered queue, so fast rolls never lose a hit.
  // Multi-touch: each finger owns the pad it landed on.
  //
  // Which pads are lit (held in momentary mode, latched in toggle mode) lives in the feedback
  // store, so incoming OSC and sync peers light the same pads, and toggling reads the state
  // everyone sees. Each pad counts as touched on its own (input for other pads still lands).
  import type { PadsWidget } from '../../model/preset';
  import { emitValue } from '../../osc/flow';
  import { padEvent } from '../../osc/value';
  import { tapHaptic } from '../../platform/haptics';
  import { flag } from '../../skins/anatomy';
  import { feedback } from '../../state/feedback.svelte';
  import { begin } from '../../state/touch';
  import { charWidth } from '../../ui/textfit';
  import Keycap from '../Keycap.svelte';
  import WidgetFrame from '../WidgetFrame.svelte';

  let { widget, live }: { widget: PadsWidget; live: boolean } = $props();

  const p = $derived(widget.props);
  const pads = $derived(Array.from({ length: p.rows * p.cols }, (_, i) => i + 1));

  /** Pads lit (held or latched), by number: shared with input mapping and sync. */
  const lit = $derived(feedback.padLit[widget.id] ?? {});
  /** Trigger pads hit from outside: each bump flashes the pad once. */
  const remoteFlashes = $derived(feedback.padFlash[widget.id] ?? {});
  /** Pads under a finger here and now (a trigger pad lights only while pressed). */
  let down = $state<Record<number, boolean>>({});
  /** Restarts a pad's release dissolve. */
  let flashes = $state<Record<number, number>>({});
  /** pointerId → pad number, so each finger releases its own pad. */
  const held = new Map<number, number>();

  let bw = $state(0);
  const showNumbers = $derived(bw / p.cols >= String(p.rows * p.cols).length * charWidth() + 6);

  function hit(number: number, on: boolean) {
    const row = Math.floor((number - 1) / p.cols) + 1;
    const col = ((number - 1) % p.cols) + 1;
    emitValue(widget.id, padEvent(p, row, col, on), true);
  }

  function onpointerdown(e: PointerEvent) {
    if (!live) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-pad]');
    if (!el) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const number = Number(el.dataset.pad);
    tapHaptic('medium');
    held.set(e.pointerId, number);
    begin(`${widget.id}#${number}`, e.pointerId);
    down[number] = true;
    hit(number, p.mode === 'toggle' ? !lit[number] : true);
  }

  function onpointerup(e: PointerEvent) {
    const number = held.get(e.pointerId);
    if (number === undefined) return;
    held.delete(e.pointerId);
    // Another finger may still hold the same pad.
    if ([...held.values()].includes(number)) return;
    down[number] = false;
    if (p.mode === 'toggle') return;
    flashes[number] = (flashes[number] ?? 0) + 1;
    if (p.mode === 'momentary') hit(number, false);
  }
</script>

<WidgetFrame
  {widget}
  {live}
  status="{p.rows}×{p.cols}"
  active={Object.values(lit).some(Boolean) || Object.values(down).some(Boolean)}
  role="group"
  aria-label={widget.label}
  {onpointerdown}
  {onpointerup}
  onpointercancel={onpointerup}
>
  {#snippet children()}
    <div
      class="grid"
      data-part="pads.grid"
      bind:clientWidth={bw}
      style:--rows={p.rows}
      style:--cols={p.cols}
    >
      {#each pads as n (n)}
        {@const on = !!down[n] || !!lit[n]}
        {@const flash = (flashes[n] ?? 0) + (remoteFlashes[n] ?? 0)}
        <!-- Each pad is a small key cap; held (or latched) pads sit sunk into the panel. -->
        <div class="pad" data-part="pads.pad" data-on={flag(on)} data-pad={n}>
          <Keycap depth={8} down={on}>
            {#key flash}
              <span
                class="fill"
                data-part="pads.fill"
                data-on={flag(on)}
                data-flash={flag(!on && flash > 0)}
              ></span>
            {/key}
            {#if showNumbers}<span class="num" data-part="pads.num" data-on={flag(on)}>{n}</span
              >{/if}
          </Keycap>
        </div>
      {/each}
    </div>
  {/snippet}
</WidgetFrame>

<style>
  :global(.frame[data-type='pads'][data-live]) {
    cursor: pointer;
  }
  .grid {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-columns: repeat(var(--cols), 1fr);
    grid-template-rows: repeat(var(--rows), 1fr);
    gap: var(--pads-gap, 4px);
  }
  .pad {
    position: relative;
    min-width: 0;
    min-height: 0;
  }
  .fill {
    position: absolute;
    inset: 0;
  }
  .num {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    pointer-events: none;
  }
</style>
