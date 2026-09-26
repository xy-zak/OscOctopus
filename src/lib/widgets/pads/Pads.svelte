<script lang="ts">
  // A grid of numbered pads: 1…rows×cols in reading order (top-left = 1). Every hit sends
  //   {number, row, col, on}     (row and col count from 1 at the top-left)
  // through the ordered queue, so fast rolls never lose a hit.
  // Multi-touch: each finger owns the pad it landed on.
  import type { PadsWidget } from '../../model/preset';
  import { padEvent } from '../../osc/value';
  import { emitValue } from '../../osc/sender';
  import { tapHaptic } from '../../platform/haptics';
  import { charWidth } from '../../ui/textfit';
  import Keycap from '../Keycap.svelte';
  import WidgetFrame from '../WidgetFrame.svelte';

  let { widget, live }: { widget: PadsWidget; live: boolean } = $props();

  const p = $derived(widget.props);
  const pads = $derived(Array.from({ length: p.rows * p.cols }, (_, i) => i + 1));

  /** Pads currently held (momentary) or latched (toggle), by number. */
  let lit = $state<Record<number, boolean>>({});
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
    const on = p.mode === 'toggle' ? !lit[number] : true;
    lit[number] = on;
    hit(number, on);
  }

  function onpointerup(e: PointerEvent) {
    const number = held.get(e.pointerId);
    if (number === undefined) return;
    held.delete(e.pointerId);
    // Another finger may still hold the same pad.
    if ([...held.values()].includes(number)) return;
    if (p.mode === 'toggle') return;
    lit[number] = false;
    flashes[number] = (flashes[number] ?? 0) + 1;
    if (p.mode === 'momentary') hit(number, false);
  }
</script>

<WidgetFrame
  class="pads {live ? 'live' : ''}"
  title={widget.label}
  status="{p.rows}×{p.cols}"
  color={widget.color}
  active={Object.values(lit).some(Boolean)}
  role="group"
  aria-label={widget.label}
  {onpointerdown}
  {onpointerup}
  onpointercancel={onpointerup}
>
  {#snippet children()}
    <div class="grid" bind:clientWidth={bw} style:--rows={p.rows} style:--cols={p.cols}>
      {#each pads as n (n)}
        {@const on = !!lit[n]}
        <!-- Each pad is a small key cap; held (or latched) pads sit sunk into the panel. -->
        <div class="pad" class:on data-pad={n}>
          <Keycap depth={8} down={on}>
            {#key flashes[n] ?? 0}
              <span class="fill" class:dissolve={!on && (flashes[n] ?? 0) > 0}></span>
            {/key}
            {#if showNumbers}<span class="num">{n}</span>{/if}
          </Keycap>
        </div>
      {/each}
    </div>
  {/snippet}
</WidgetFrame>

<style>
  :global(.frame.pads.live) {
    cursor: pointer;
  }
  .grid {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-columns: repeat(var(--cols), 1fr);
    grid-template-rows: repeat(var(--rows), 1fr);
    gap: 4px;
  }
  /* At rest each pad is a key in the widget colour; held or latched, it goes ACTIVE green. */
  .pad {
    --key-edge: var(--c);
    --key-dots: color-mix(in srgb, var(--c) 55%, transparent);
    --key-face: var(--c-solid);
    position: relative;
    min-width: 0;
    min-height: 0;
  }
  .pad.on {
    --key-edge: var(--act);
    --key-dots: color-mix(in srgb, var(--act) 55%, transparent);
  }
  .fill {
    position: absolute;
    inset: 0;
  }
  .on .fill {
    background: var(--act);
  }
  /* Release: the same pixel dissolve as the button. */
  .fill.dissolve {
    animation: dissolve 210ms steps(1, end) forwards;
  }
  @keyframes dissolve {
    0% {
      background: var(--act);
    }
    33% {
      background: var(--dither-50-act);
    }
    66% {
      background: var(--dither-25-act);
    }
    100% {
      background: transparent;
    }
  }
  .num {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: var(--c-ink);
    font-weight: 700;
    pointer-events: none;
  }
  .on .num {
    color: var(--act-ink);
  }
</style>
