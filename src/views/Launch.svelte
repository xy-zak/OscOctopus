<script lang="ts">
  // The launch screen, shown the moment the page loads (main.ts) while the app loads and starts
  // behind it. The octopus draws itself row by row, the title types out, and the cursor blinks
  // until the app is `ready` (never longer than MAX_WAIT_MS). Then it closes in reverse: the
  // background thins to a dither (like a dialog's backdrop) that shows the app, already started,
  // behind it; the title is deleted letter by letter, the octopus undrawn row by row, and the
  // dither fades. Reduced motion: no typing, a quick fade.
  import { onMount } from 'svelte';
  import PixelLogo from '../lib/ui/PixelLogo.svelte';

  let { ready, ondone }: { ready: Promise<unknown>; ondone: () => void } = $props();

  const TITLE = 'OSC-OCTOPUS';
  /** The octopus's 8 rows appear (and go) one by one. */
  const DRAW_MS = 320;
  const CHAR_MS = 55;
  /** Deleting is quicker than typing. */
  const UNTYPE_MS = 30;
  /** The whole title stays up at least this long, however fast the app starts. */
  const HOLD_MS = 350;
  /** A slow start never keeps the screen up longer than this after the title; the app then
      says it is still starting. */
  const MAX_WAIT_MS = 5000;
  /** The background thinning to the dither. */
  const REVEAL_MS = 400;
  const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)'; // --ease-out
  /** Pixel-y, like the dialogs' own fade (`modal-fade`, app.css). */
  const FADE_MS = 180;

  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let typed = $state(still ? TITLE.length : 0);
  /** The cursor, until the title is deleted. */
  let cursor = $state(true);
  let screen: HTMLDivElement;
  let solid: HTMLDivElement;
  let logo: HTMLDivElement;

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const fill = 'forwards';

  async function close() {
    if (still) {
      await screen.animate({ opacity: [1, 0] }, { duration: 150, fill }).finished;
      return;
    }
    await solid.animate({ opacity: [1, 0] }, { duration: REVEAL_MS, easing: EASE, fill }).finished;
    for (; typed > 0; typed--) await wait(UNTYPE_MS);
    cursor = false;
    await logo.animate(
      { clipPath: ['inset(0)', 'inset(0 0 100% 0)'] },
      { duration: DRAW_MS, easing: 'steps(8, end)', fill },
    ).finished;
    await screen.animate({ opacity: [1, 0] }, { duration: FADE_MS, easing: 'steps(3, end)', fill })
      .finished;
  }

  onMount(() => {
    void (async () => {
      if (!still) {
        await wait(DRAW_MS);
        for (; typed < TITLE.length; typed++) await wait(CHAR_MS);
      }
      await Promise.all([Promise.race([ready, wait(MAX_WAIT_MS)]), wait(HOLD_MS)]);
      // Let the app paint what it just rendered before uncovering it.
      await frame();
      await frame();
      await close();
      ondone();
    })();
  });
</script>

<div
  class="launch"
  class:still
  bind:this={screen}
  style:--draw-ms="{DRAW_MS}ms"
  role="status"
  aria-label="{TITLE}, starting"
>
  <div class="backdrop dither"></div>
  <div class="backdrop solid" bind:this={solid}></div>
  <div class="logo" bind:this={logo}><PixelLogo /></div>
  <div class="title" aria-hidden="true" style:width="{TITLE.length + 1}ch">
    {TITLE.slice(0, typed)}{#if cursor}<span class="cursor" class:waiting={typed === TITLE.length}
        >█</span
      >{/if}
  </div>
</div>

<style>
  .launch {
    /* The only text larger than --fs, with About's title (docs/ARCHITECTURE.md › Design rules). */
    --title-fs: clamp(28px, 7vw, 64px);
    position: fixed;
    inset: 0;
    z-index: 300;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: calc(var(--title-fs) * 0.6);
    padding: 2ch;
  }
  /* The solid background over the dither: fading it out shows the app through the dither. */
  .backdrop {
    position: absolute;
    inset: 0;
    z-index: -1;
  }
  .dither {
    background: var(--backdrop-dither);
  }
  .solid {
    background: var(--bg);
  }
  .logo {
    display: flex;
  }
  .logo :global(svg) {
    width: calc(var(--title-fs) * 2.25);
    height: calc(var(--title-fs) * 2);
  }
  /* Drawn top to bottom, one pixel row per step. */
  .launch:not(.still) .logo :global(svg) {
    animation: draw var(--draw-ms) steps(8, end) both;
  }
  @keyframes draw {
    from {
      clip-path: inset(0 0 100% 0);
    }
    to {
      clip-path: inset(0);
    }
  }
  /* As wide as the whole title and its cursor from the start, so typing never shifts it. */
  .title {
    font-size: var(--title-fs);
    line-height: 1;
    font-weight: 700;
    white-space: nowrap;
    /* Keeps its line once the title and cursor are deleted, so the octopus stays put. */
    min-height: 1em;
  }
  /* Solid while it types, blinking while the app finishes starting. */
  .cursor {
    color: var(--accent);
  }
  .cursor.waiting {
    animation: blink 1s steps(1) infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0;
    }
  }
</style>
