<script lang="ts">
  // Pick one of N options. Sends {index, label, value} (numeric-looking values as numbers).
  // Layout: a vertical list, or a horizontal strip when the widget is wider than tall (or as
  // configured). Like the pads, an option only lights while it is pressed, then dissolves;
  // the current one is marked quietly (bold, ▸, and n/N in the border). Long vertical lists
  // scroll; selection is on click, so a scroll gesture never selects by accident (the browser
  // cancels the press, which just unlights it). Arrow keys step through the options.
  import { clamp } from '../../util';
  import type { ListWidget } from '../../model/preset';
  import { isRecord, listValue } from '../../osc/value';
  import { emitValue } from '../../osc/flow';
  import { tapHaptic } from '../../platform/haptics';
  import { values } from '../../state/values.svelte';
  import WidgetFrame from '../WidgetFrame.svelte';

  let { widget, live }: { widget: ListWidget; live: boolean } = $props();

  const p = $derived(widget.props);
  const raw = $derived(values[widget.id]);
  const index = $derived(
    clamp(
      isRecord(raw) && typeof raw.index === 'number' ? raw.index : p.defaultIndex,
      0,
      p.options.length - 1,
    ),
  );

  let bw = $state(0);
  let bh = $state(0);
  const horizontal = $derived(p.layout === 'horizontal' || (p.layout === 'auto' && bw > bh * 1.6));

  /** The option under the finger right now: lit while held. */
  let held = $state<number | null>(null);
  /** Restarts an option's release dissolve. */
  let flashes = $state<Record<number, number>>({});
  const flash = (i: number) => (flashes[i] = (flashes[i] ?? 0) + 1);

  function select(i: number, fromKey = false) {
    if (!live) return;
    const next = clamp(i, 0, p.options.length - 1);
    if (next !== index) tapHaptic('light');
    // No finger to lift for a key press: just the release dissolve.
    if (fromKey) flash(next);
    // Re-selecting the current option still sends: it's an explicit command.
    emitValue(widget.id, listValue(p.options, next), true);
  }

  function press(i: number) {
    if (live) held = i;
  }

  function release(i: number, lifted: boolean) {
    if (held !== i) return;
    held = null;
    if (lifted) flash(i);
  }

  function onkeydown(e: KeyboardEvent) {
    if (!live) return;
    const prev = horizontal ? 'ArrowLeft' : 'ArrowUp';
    const next = horizontal ? 'ArrowRight' : 'ArrowDown';
    if (e.key === prev) select(index - 1, true);
    else if (e.key === next) select(index + 1, true);
    else if (e.key === 'Home') select(0, true);
    else if (e.key === 'End') select(p.options.length - 1, true);
    else return;
    e.preventDefault();
  }
</script>

<WidgetFrame
  class="list {live ? 'live' : ''}"
  title={widget.label}
  status="{index + 1}/{p.options.length}"
  color={widget.color}
  role="listbox"
  aria-label={widget.label}
  aria-activedescendant="{widget.id}-opt-{index}"
  tabindex={live ? 0 : -1}
  {onkeydown}
>
  {#snippet children()}
    <div class="options" class:horizontal bind:clientWidth={bw} bind:clientHeight={bh}>
      {#each p.options as o, i (i)}
        <button
          type="button"
          class="opt"
          class:on={i === index}
          class:held={held === i}
          id="{widget.id}-opt-{i}"
          role="option"
          aria-selected={i === index}
          tabindex="-1"
          onpointerdown={() => press(i)}
          onpointerup={() => release(i, true)}
          onpointerleave={() => release(i, false)}
          onpointercancel={() => release(i, false)}
          onclick={() => select(i)}
        >
          {#key flashes[i] ?? 0}
            <span class="fill" class:dissolve={held !== i && (flashes[i] ?? 0) > 0}></span>
          {/key}
          <span class="mark">{i === index ? '▸' : ' '}</span><span class="text"
            >{o.label || o.value}</span
          >
        </button>
      {/each}
    </div>
  {/snippet}
</WidgetFrame>

<style>
  .options {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow-y: auto;
    overflow-x: hidden;
    touch-action: pan-y;
    scrollbar-width: thin;
  }
  .options.horizontal {
    flex-direction: row;
    overflow: hidden;
    touch-action: none;
  }
  /* ACTIVE green only while pressed, then the pads' pixel dissolve back to the widget colour. */
  .fill {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .held .fill {
    background: var(--act);
  }
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
  .mark,
  .text {
    position: relative;
  }
  .opt {
    position: relative;
    flex: none;
    display: flex;
    align-items: center;
    gap: 0.5ch;
    height: var(--lh);
    padding: 0 0.5ch;
    border: 0;
    /* Each option is a block in the widget colour; the non-current ones read a little quieter. */
    background: var(--c-solid);
    color: color-mix(in srgb, var(--c-ink) 65%, var(--c-solid));
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-transform: uppercase;
    transition: color var(--t-ui) steps(2);
  }
  .horizontal .opt {
    flex: 1;
    height: auto;
    justify-content: center;
    padding: 0 0.5ch;
    min-width: 0;
  }
  .horizontal .mark {
    display: none;
  }
  .text {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  :global(.frame.list.live) .opt {
    cursor: pointer;
  }
  :global(.frame.list.live) .opt:not(.on):not(.held):hover {
    color: var(--c-ink);
  }
  /* The current option: marked, not lit. */
  .opt.on {
    color: var(--c-ink);
    font-weight: 700;
  }
  .opt.held {
    color: var(--act-ink);
  }
</style>
