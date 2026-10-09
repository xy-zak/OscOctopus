<script lang="ts">
  // ABOUT: who made the app and what it stands for. Opened from the logo in the top bar
  // (App.svelte); Esc, CLOSE and clicking the backdrop close it.
  import { version } from '../../package.json';
  import { toast, ui } from '../lib/state/ui.svelte';
  import { tour } from '../lib/tour/app.svelte';
  import { errorText } from '../lib/util';
  import PixelLogo from '../lib/ui/PixelLogo.svelte';

  /** What it stands for. About the beliefs, not the app's features. */
  const BELIEFS = [
    ['Open-source', 'Tools for making shows should be open: free to read, change, fix and share.'],
    ['Cross-platform', 'Whatever device is to hand should be able to join in, whatever it runs.'],
    [
      'Transparent',
      'Every message should be visible, down to the byte. Nothing hidden, nothing guessed.',
    ],
    ['Multi-user', 'Shows are made by teams, so control should be shared between people, live.'],
    ['Customisable', 'Controls should fit the person and the show, not the other way round.'],
    ['Flexible', 'Speak to any device, in whatever form of message it expects.'],
    [
      'Built for live production',
      'When the show is running nothing should surprise you: safe by default, steady under pressure.',
    ],
  ] as const;

  let closeBtn = $state<HTMLButtonElement>();
  $effect(() => {
    if (ui.aboutOpen) closeBtn?.focus();
  });
  const close = () => (ui.aboutOpen = false);

  function startTour() {
    close();
    tour.start().catch((e: unknown) => toast(`Tour: ${errorText(e)}`, 'error'));
  }

  function onkeydown(e: KeyboardEvent) {
    if (ui.aboutOpen && e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }
</script>

<svelte:window {onkeydown} />

{#if ui.aboutOpen}
  <div
    class="modal-backdrop"
    role="presentation"
    onpointerdown={(e) => e.target === e.currentTarget && close()}
  >
    <div class="modal about" role="dialog" aria-modal="true" aria-labelledby="about-title">
      <span class="modal-title">About</span>
      <div class="scroll body">
        <header>
          <PixelLogo size={48} />
          <h1 id="about-title">OSC-OCTOPUS</h1>
          <span class="faint">v{version}</span>
        </header>

        <div class="credits">
          <p><span class="muted">Programmed by</span> <strong>Zak Silver-Lennard</strong></p>
          <p><span class="muted">Designed by</span> <strong>Bart van Nes</strong></p>
          <p class="muted">With the help of Claude Code</p>
        </div>

        <dl>
          {#each BELIEFS as [term, text] (term)}
            <dt>{term}</dt>
            <dd>{text}</dd>
          {/each}
        </dl>
      </div>
      <div class="modal-actions">
        <button class="btn" bind:this={closeBtn} onclick={close}>Close</button>
        <!-- FREEZE keeps desks as they are, and the tour opens one of its own. -->
        <span data-tip={tour.available ? undefined : 'Unfreeze first: hold FREEZE for 1 second'}>
          <button class="btn primary" disabled={!tour.available} onclick={startTour}
            >Take the tour</button
          >
        </span>
      </div>
    </div>
  </div>
{/if}

<style>
  .about {
    width: min(64ch, 100%);
    display: flex;
    flex-direction: column;
    max-height: calc(100dvh - 48px);
  }
  .body {
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  header {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding-top: 6px;
  }
  /* The only text larger than --fs, with the launch screen's (docs/ARCHITECTURE.md › Design
     rules). */
  h1 {
    margin: 4px 0 0;
    font-size: calc(var(--fs) * 2);
    line-height: 1.2;
    font-weight: 700;
  }
  .credits {
    text-align: center;
  }
  p {
    margin: 0;
  }
  dl {
    display: grid;
    /* Room for the longest one-word belief; "Built for live production" wraps. */
    grid-template-columns: 15ch 1fr;
    gap: 4px 2ch;
    margin: 0;
  }
  dt {
    font-weight: 700;
    text-transform: uppercase;
  }
  dd {
    margin: 0;
  }
  /* Narrow: each belief above its text. */
  @media (max-width: 520px) {
    dl {
      grid-template-columns: 1fr;
      gap: 0;
    }
    dd + dt {
      margin-top: 6px;
    }
  }
</style>
