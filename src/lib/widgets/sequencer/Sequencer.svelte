<script lang="ts">
  // A wait bar, two key caps (see Keycap) and a strip with one mark per step:
  //   the bar        fills over the wait until the next step (skins/base.css times it);
  //   START / STOP   plays the sequence from its first step, or stops it;
  //   PAUSE / PLAY   holds it where it is (keeping the rest of the wait), or goes on.
  // The Rust core times the run (state/sequencer.svelte.ts), so it keeps playing when this
  // component is gone (another tab, another desk) and in the background. A key acts on press,
  // like a button; while not live (EDIT, LOCK) the keys ignore input.
  import type { SequencerWidget } from '../../model/preset';
  import { tapHaptic } from '../../platform/haptics';
  import { flag } from '../../skins/anatomy';
  import { sequencerStore, type SeqRun } from '../../state/sequencer.svelte';
  import { fitsIn } from '../../ui/textfit';
  import Keycap from '../Keycap.svelte';
  import WidgetFrame from '../WidgetFrame.svelte';

  let { widget, live }: { widget: SequencerWidget; live: boolean } = $props();

  type Role = 'play' | 'pause';
  const ROLES: readonly Role[] = ['play', 'pause'];

  const p = $derived(widget.props);
  const run = $derived(sequencerStore.runs[widget.id]);
  const running = $derived(run?.state === 'running');
  const paused = $derived(run?.state === 'paused');
  const current = $derived(run?.step ?? null);

  /** How much of the current wait has passed, in ms: as reported, plus the time since. */
  function waited(r: SeqRun): number {
    const wait = r.waitMs ?? 0;
    const since = r.state === 'running' ? Math.max(0, Date.now() * 1000 - r.atMicros) / 1000 : 0;
    return Math.min(wait, wait - (r.leftMs ?? 0) + since);
  }

  /** The key under a finger, and each key's release flash counter. */
  let down = $state<Role | null>(null);
  let flashes = $state<Record<Role, number>>({ play: 0, pause: 0 });

  /** Each key's glyph and word; a narrow key shows only the glyph (both keys alike). */
  const legend = $derived({
    play: run ? ['■', 'STOP'] : ['▶', 'START'],
    pause: paused ? ['▶', 'PLAY'] : ['❚❚', 'PAUSE'],
  });
  let keysWidth = $state(0);
  const words = $derived(fitsIn('❚❚ PAUSE', keysWidth / 2 - 8));
  const titles = $derived({
    play: run ? 'Stop the sequence' : 'Play the sequence from its first step',
    pause: paused ? 'Go on from where it paused' : 'Pause where it is',
  });

  const passes = $derived(p.repeat === 'forever' ? '∞' : `×${p.count}`);
  const status = $derived(
    run
      ? `${paused ? '❚❚ ' : ''}${(current ?? -1) + 1}/${p.steps.length} · ${run.pass}${
          p.repeat === 'count' ? `/${p.count}` : ''
        }`
      : `${p.steps.length} STEPS ${passes}`,
  );

  function act(role: Role) {
    if (role === 'play') {
      tapHaptic('heavy');
      if (run) sequencerStore.stop(widget.id);
      else void sequencerStore.play(widget.id);
    } else if (run) {
      tapHaptic('medium');
      if (paused) sequencerStore.resume(widget.id);
      else sequencerStore.pause(widget.id);
    }
  }

  function press(role: Role) {
    if (!live || down) return;
    down = role;
    act(role);
  }

  function release(role: Role) {
    if (down !== role) return;
    down = null;
    flashes[role]++;
  }

  function onpointerdown(e: PointerEvent, role: Role) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    press(role);
  }

  function onkeydown(e: KeyboardEvent, role: Role) {
    if (e.repeat || (e.key !== ' ' && e.key !== 'Enter')) return;
    e.preventDefault();
    press(role);
  }

  function onkeyup(e: KeyboardEvent, role: Role) {
    if (e.key === ' ' || e.key === 'Enter') release(role);
  }
</script>

<WidgetFrame
  {widget}
  {live}
  {status}
  active={!!run}
  data-running={flag(running)}
  data-paused={flag(paused)}
  role="group"
  aria-label={widget.label}
>
  {#snippet children()}
    <div class="layout">
      <div class="timer" data-part="sequencer.timer" aria-hidden="true">
        {#if run?.waitMs}
          <!-- Restarted by every report (a step sent, a pause, a resume), from where it is. -->
          {#key run.atMicros}
            <span
              class="elapsed"
              data-part="sequencer.elapsed"
              style:--seq-wait="{run.waitMs}ms"
              style:--seq-waited="{-waited(run)}ms"
            ></span>
          {/key}
        {/if}
      </div>
      <div class="keys" data-part="sequencer.keys" bind:clientWidth={keysWidth}>
        {#each ROLES as role (role)}
          <button
            type="button"
            class="key"
            data-part="sequencer.key"
            data-role={role}
            aria-label={titles[role]}
            title={titles[role]}
            tabindex={live ? 0 : -1}
            onpointerdown={(e) => onpointerdown(e, role)}
            onpointerup={() => release(role)}
            onpointercancel={() => release(role)}
            onkeydown={(e) => onkeydown(e, role)}
            onkeyup={(e) => onkeyup(e, role)}
          >
            <Keycap depth={12} down={down === role}>
              {#key flashes[role]}
                <span
                  class="fill"
                  data-part="sequencer.fill"
                  data-on={flag(down === role)}
                  data-flash={flag(down !== role && flashes[role] > 0)}
                ></span>
              {/key}
              <span class="legend" data-part="sequencer.legend"
                >{words ? legend[role].join(' ') : legend[role][0]}</span
              >
            </Keycap>
          </button>
        {/each}
      </div>
      <div class="steps" data-part="sequencer.steps" aria-hidden="true">
        {#each p.steps as s, i (s.id)}
          <span class="step" data-part="sequencer.step" data-current={flag(i === current)}></span>
        {/each}
      </div>
    </div>
  {/snippet}
</WidgetFrame>

<style>
  :global(.frame[data-type='sequencer'][data-live]) .key {
    cursor: pointer;
  }
  .layout {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    gap: var(--seq-gap, 4px);
  }
  .timer {
    flex: none;
    position: relative;
    height: var(--seq-timer-h, 4px);
  }
  .elapsed {
    position: absolute;
    inset: 0;
  }
  .keys {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--seq-gap, 4px);
  }
  .key {
    position: relative;
    min-width: 0;
    padding: 0;
  }
  .fill {
    position: absolute;
    inset: 0;
  }
  .legend {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    white-space: nowrap;
    overflow: hidden;
    pointer-events: none;
  }
  .steps {
    flex: none;
    display: flex;
    gap: var(--seq-step-gap, 2px);
    height: var(--seq-steps-h, 6px);
  }
  .step {
    flex: 1;
    min-width: 0;
  }
</style>
