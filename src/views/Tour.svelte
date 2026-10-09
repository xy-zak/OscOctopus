<script lang="ts">
  // The tour on screen (lib/tour): a dither over the app with a hole around what the step is
  // about, an accent frame in the hole, the step's popup beside it, and the progress bar along
  // the bottom (one segment per level; click one to jump to it). Show only: App makes the app
  // inert while it runs, and every key goes to the tour first (← → Enter, Esc to leave).
  //
  // Where the tour has taken you is always shown twice: the popup names it (the desk or GLOBAL
  // SETTINGS, the section, and EDIT) beside a bar in the frame's colour, and the tab, the section
  // (and EDIT) are framed in that colour through the dither. When a step is somewhere else than
  // the one before, both flash and the popup says "Moved to".
  import { tick } from 'svelte';
  import { presetStore } from '../lib/state/preset.svelte';
  import { currentSection, currentSections, ui } from '../lib/state/ui.svelte';
  import { tour } from '../lib/tour/app.svelte';
  import { clampBox, placePopup, unionBox, type Side } from '../lib/tour/place';
  import { LEVELS, levelRanges, placeKey, targetsOf } from '../lib/tour/steps';
  import type { Box } from '../lib/ui/tooltip';

  /** Space between the highlighted element and the hole's edge. */
  const PAD = 6;
  /** Space around a "you are here" marker. */
  const HERE_PAD = 2;
  const ranges = levelRanges(tour.steps);

  let hole = $state<Box | null>(null);
  /** The tab, the section and (in EDIT) the EDIT switch: where the tour is. */
  let here = $state<Box[]>([]);
  /** Bumped when a step is somewhere else than the one before: the markers flash. */
  let moves = $state(0);
  let moved = $state(true);
  let shownKey: string | null = null;
  let pos = $state<{ left: number; top: number; side: Side }>({ left: 0, top: 0, side: 'centre' });
  let vw = $state(innerWidth);
  let vh = $state(innerHeight);
  let popup = $state<HTMLDivElement>();
  let bar = $state<HTMLDivElement>();
  let nextBtn = $state<HTMLButtonElement>();

  const step = $derived(tour.step);
  const level = $derived(LEVELS.find((l) => l.id === step.level)!);

  /** Where the tour is, as the popup names it. */
  const location = $derived.by(() => {
    const sections = currentSections();
    const i = sections.findIndex((s) => s.id === currentSection());
    const container = ui.view === 'desk' ? presetStore.current.name : 'GLOBAL SETTINGS';
    const section = i >= 0 ? `F${i + 1} ${sections[i]!.label}` : '';
    const edit = ui.view === 'desk' && ui.deskView === 'controls' && ui.mode === 'edit';
    return { container, section, edit };
  });

  /** The elements that say where the tour is: the tab, the section, and EDIT when on. */
  function markers(): HTMLElement[] {
    const sel = [
      '[data-tour="desk-tab"] [aria-selected="true"]',
      '[data-tour="global-tab"] [aria-selected="true"]',
      '[data-tour="sections"] [aria-selected="true"]',
    ];
    if (ui.mode === 'edit') sel.push('[data-tour="desk-switches"] [aria-checked="true"]');
    return [...document.querySelectorAll<HTMLElement>(sel.join(','))];
  }

  const grow = (b: Box, by: number): Box => ({
    left: b.left - by,
    top: b.top - by,
    width: b.width + 2 * by,
    height: b.height + 2 * by,
  });
  const overlaps = (a: Box, b: Box) =>
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height;

  /** What the step highlights, if it is on screen. */
  function targets(): HTMLElement[] {
    return targetsOf(tour.step)
      .flatMap((id) => [...document.querySelectorAll<HTMLElement>(`[data-tour="${id}"]`)])
      .filter((el) => el.getClientRects().length > 0);
  }

  function measure() {
    if (!tour.active) return;
    vw = innerWidth;
    vh = innerHeight;
    const below = vh - (bar?.offsetHeight ?? 0);
    const box = unionBox(targets().map((el) => el.getBoundingClientRect()));
    // A target taller or wider than the screen (a long page) is framed where it is visible.
    hole = box && clampBox(grow(box, PAD), vw, below);
    here = markers().map((el) => grow(el.getBoundingClientRect(), HERE_PAD));
    if (!popup) return;
    const size = { width: popup.offsetWidth, height: popup.offsetHeight };
    pos = placePopup(hole, size, { width: vw, height: below });
  }

  // Measures at most once a frame, however often something moves.
  let queued = 0;
  function remeasure() {
    if (!queued) queued = requestAnimationFrame(() => ((queued = 0), measure()));
  }
  const frame = () => new Promise((r) => requestAnimationFrame(r));

  // Each step: let the UI get there, bring the target into view, measure, and keep measuring
  // while anything it depends on changes size or scrolls.
  $effect(() => {
    if (!tour.active) return;
    void tour.index;
    let gone = false;
    const seen = new ResizeObserver(remeasure);
    void (async () => {
      await tick();
      await frame();
      await frame();
      if (gone) return;
      const key = placeKey(tour.step.at);
      moved = key !== shownKey;
      shownKey = key;
      if (moved) moves++;
      const els = targets();
      els[0]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      for (const el of els) seen.observe(el);
      if (popup) seen.observe(popup);
      measure();
      nextBtn?.focus();
    })();
    return () => {
      gone = true;
      seen.disconnect();
    };
  });

  $effect(() => {
    if (!tour.active) return;
    addEventListener('resize', remeasure);
    addEventListener('scroll', remeasure, true);
    addEventListener('keydown', onkeydown, true);
    return () => {
      removeEventListener('resize', remeasure);
      removeEventListener('scroll', remeasure, true);
      removeEventListener('keydown', onkeydown, true);
      cancelAnimationFrame(queued);
      queued = 0;
    };
  });

  /** Before anything else hears it: the app's own shortcuts must not change what is shown. */
  function onkeydown(e: KeyboardEvent) {
    e.stopPropagation();
    const onButton = e.target instanceof HTMLButtonElement;
    if (e.key === 'ArrowRight' || (e.key === 'Enter' && !onButton)) tour.next();
    else if (e.key === 'ArrowLeft') tour.back();
    else if (e.key === 'Escape') void tour.exit();
    else return;
    e.preventDefault();
  }

  /** The dither everywhere except the holes: the target, and each marker that doesn't overlap
      it (under evenodd, overlapping holes would cancel out). */
  const clip = $derived.by(() => {
    const holes = hole ? [hole] : [];
    for (const m of here) if (holes.every((h) => !overlaps(h, m))) holes.push(m);
    if (!holes.length) return 'none';
    const rects = holes.map(
      ({ left: l, top: t, width: w, height: h }) => `M${l} ${t}H${l + w}V${t + h}H${l}Z`,
    );
    return `path(evenodd, "M0 0H${vw}V${vh}H0Z ${rects.join(' ')}")`;
  });

  /** How far through a level the tour is: 0…1. */
  const filled = (start: number, count: number) =>
    Math.max(0, Math.min(1, (tour.index - start + 1) / count));
</script>

{#if tour.active}
  <div class="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
    <div class="blocker"></div>
    <div class="dither" style:clip-path={clip}></div>
    {#key moves}
      {#each here as m, i (i)}
        <div
          class="here"
          style:left="{m.left}px"
          style:top="{m.top}px"
          style:width="{m.width}px"
          style:height="{m.height}px"
        ></div>
      {/each}
    {/key}
    {#if hole}
      <div
        class="spot"
        style:left="{hole.left}px"
        style:top="{hole.top}px"
        style:width="{hole.width}px"
        style:height="{hole.height}px"
      ></div>
    {/if}

    <div class="modal pop" bind:this={popup} style:left="{pos.left}px" style:top="{pos.top}px">
      <span class="modal-title">{level.label} · {tour.index + 1} / {tour.steps.length}</span>
      {#key moves}
        <p class="where" class:moved>
          <span class="where-tag">{moved ? 'Moved to' : 'In'}</span>
          <span class="where-name"
            >{location.container}{#if location.section}<span class="sep">
                ›
              </span>{location.section}{/if}{#if location.edit}<span class="sep">
                ·
              </span>EDIT{/if}</span
          >
        </p>
      {/key}
      <p id="tour-title" class="title">{step.title}</p>
      <p class="body">{step.body}</p>
      <div class="modal-actions">
        <button class="btn ghost exit" onclick={() => void tour.exit()}>Exit tour</button>
        <button class="btn" disabled={tour.index === 0} onclick={() => tour.back()}>Back</button>
        <button class="btn primary" bind:this={nextBtn} onclick={() => tour.next()}
          >{tour.last ? 'Done' : 'Next'}</button
        >
      </div>
    </div>

    <div class="bar" bind:this={bar} role="group" aria-label="Tour levels">
      {#each ranges as r (r.level)}
        {@const label = LEVELS.find((l) => l.id === r.level)!.label}
        <button
          class="level"
          class:current={r.level === step.level}
          style:flex-grow={r.count}
          aria-label="{label}: from step {r.start + 1}"
          onclick={() => tour.jump(r.level)}
        >
          <span class="label">{label}</span>
          <span class="track"
            ><span class="fill" style:width="{filled(r.start, r.count) * 100}%"></span></span
          >
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  /* Above toasts and menus, under dialogs, the launch screen and tooltips (docs/ARCHITECTURE.md). */
  .tour {
    --t-tour: 240ms;
    position: fixed;
    inset: 0;
    z-index: 150;
  }
  @media (prefers-reduced-motion: reduce) {
    .tour {
      --t-tour: 0ms;
    }
  }
  /* Takes every pointer event: nothing under the tour can be touched. */
  .blocker,
  .dither {
    position: absolute;
    inset: 0;
  }
  .dither {
    background: var(--backdrop-dither);
    pointer-events: none;
    transition: clip-path var(--t-tour) var(--ease-out);
  }
  .spot {
    position: absolute;
    border: 2px solid var(--accent);
    box-shadow: 4px 4px 0 0 var(--shadow-px);
    pointer-events: none;
    transition:
      left var(--t-tour) var(--ease-out),
      top var(--t-tour) var(--ease-out),
      width var(--t-tour) var(--ease-out),
      height var(--t-tour) var(--ease-out);
  }
  /* Where the tour is: the tab and section (and EDIT), framed in the frame's colour. */
  .here {
    position: absolute;
    border: 2px solid var(--scope);
    pointer-events: none;
    animation: flash 900ms steps(6, end);
  }
  @keyframes flash {
    0%,
    33%,
    67% {
      border-color: transparent;
    }
  }
  .where {
    display: flex;
    align-items: baseline;
    gap: 1ch;
    margin-bottom: 10px;
    padding: 2px 1ch;
    border-left: 4px solid var(--scope);
    background: var(--bg-3);
  }
  .where.moved {
    animation: flash-bg 900ms steps(6, end);
  }
  @keyframes flash-bg {
    0%,
    33%,
    67% {
      background: color-mix(in srgb, var(--scope) 35%, var(--bg-3));
    }
  }
  .where-tag {
    flex: none;
    color: var(--fg-dim);
    text-transform: uppercase;
  }
  .where-name {
    min-width: 0;
    overflow-wrap: anywhere;
    font-weight: 700;
    text-transform: uppercase;
  }
  .sep {
    color: var(--fg-dim);
    font-weight: 400;
  }
  .pop {
    position: absolute;
    width: min(46ch, calc(100vw - 16px));
    transition:
      left var(--t-tour) var(--ease-out),
      top var(--t-tour) var(--ease-out);
  }
  p {
    margin: 0 0 6px;
  }
  .title {
    font-weight: 700;
    text-transform: uppercase;
  }
  .exit {
    margin-right: auto;
  }

  /* ---- progress: one segment per level, as long as its steps ---------------------------- */
  .bar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    gap: 1ch;
    padding: 6px 1ch calc(6px + env(safe-area-inset-bottom));
    background: var(--bg-2);
    border-top: 1px solid var(--line);
  }
  .level {
    flex-basis: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--fg-dim);
    text-align: left;
  }
  .level:hover,
  .level.current {
    color: var(--fg);
  }
  .label {
    text-transform: uppercase;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .current .label {
    font-weight: 700;
  }
  .track {
    height: 6px;
    background: var(--bg-3);
    border: 1px solid var(--line);
  }
  .fill {
    display: block;
    height: 100%;
    background: var(--fg-dim);
    transition: width var(--t-tour) steps(4, end);
  }
  .current .fill {
    background: var(--accent);
  }
</style>
