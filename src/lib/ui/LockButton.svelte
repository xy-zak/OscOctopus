<script lang="ts">
  // LOCK: one tap locks. Unlocking takes a deliberate press-and-hold (HOLD_MS) so a stray
  // touch during a show can't undo it. While holding, a fill steps across the button; a
  // release before HOLD_MS cancels and flashes a "HOLD 1 SEC" hint so it's clear what to do.
  //
  // Robustness: the button has a fixed width (the label never changes its size, so the
  // pointer can't end up outside it), and the hold is measured from the press time, so a
  // release after HOLD_MS unlocks even if the timer was delayed. Keyboard: focus it and hold
  // Space/Enter.
  import { tapHaptic } from '../platform/haptics';

  interface Props {
    locked: boolean;
    onchange: (locked: boolean) => void;
    /** Bumped whenever someone touches something locked: the button nudges and hints. */
    nudge?: number;
  }
  let { locked, onchange, nudge = 0 }: Props = $props();

  const HOLD_MS = 1000;
  const HINT_MS = 1800;
  let holding = $state(false);
  let hint = $state(false);
  let pressedAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let hintTimer: ReturnType<typeof setTimeout> | undefined;

  function showHint() {
    hint = true;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => (hint = false), HINT_MS);
  }

  $effect(() => {
    if (nudge > 0) showHint();
  });

  function unlock() {
    clearTimeout(timer);
    holding = false;
    hint = false;
    tapHaptic('heavy');
    onchange(false);
  }

  function press() {
    if (!locked) {
      tapHaptic('heavy');
      onchange(true);
      return;
    }
    holding = true;
    hint = false;
    pressedAt = performance.now();
    clearTimeout(timer);
    timer = setTimeout(unlock, HOLD_MS);
  }

  function release() {
    if (!holding) return;
    clearTimeout(timer);
    if (performance.now() - pressedAt >= HOLD_MS) unlock();
    else {
      holding = false;
      showHint();
    }
  }

  // Same anatomy as the other master switches: [■] when locked.
  const box = $derived(hint && !holding ? '' : `[${locked ? '■' : '\u00a0'}]`);
  const text = $derived(!locked ? 'LOCK' : holding ? 'HOLD…' : hint ? 'HOLD 1 SEC' : 'LOCKED');
</script>

<button
  type="button"
  class="mbtn switch lock"
  class:warn={locked}
  class:holding
  class:hint
  style:--hold="{HOLD_MS}ms"
  aria-pressed={locked}
  aria-label={locked ? 'Locked. Press and hold for one second to unlock' : 'Lock'}
  title={locked
    ? 'Locked: press and hold for 1 second to unlock'
    : 'Lock widgets and settings for a show (Alt+L)'}
  onpointerdown={(e) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    press();
  }}
  onpointerup={release}
  onpointercancel={() => {
    clearTimeout(timer);
    holding = false;
  }}
  onlostpointercapture={release}
  onkeydown={(e) => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
      e.preventDefault();
      press();
    }
  }}
  onkeyup={(e) => {
    if (e.key === ' ' || e.key === 'Enter') release();
  }}
>
  <span class="fill" aria-hidden="true"></span>
  <span class="label"
    >{#if box}<span class="box">{box}</span>{/if}{text}</span
  >
</button>

<style>
  /* The shape comes from .mbtn (app.css); the width is fixed there too, so the label can
     change while the pointer stays inside. */
  .lock {
    position: relative;
    overflow: hidden;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
  }
  .label {
    position: relative;
    display: inline-flex;
    gap: 1ch;
  }
  /* Unlock progress: steps across in ten pixel columns. */
  .fill {
    position: absolute;
    inset: 0;
    background: var(--bg);
    transform: scaleX(0);
    transform-origin: left;
  }
  .holding .fill {
    transform: scaleX(1);
    transition: transform var(--hold) steps(10, end);
  }
  .holding .label {
    color: var(--warn);
  }
  /* Hint after a short tap (or a touch on a locked widget): shake, and say what to do. */
  .hint {
    animation: nudge 360ms steps(6, end);
  }
  @keyframes nudge {
    20% {
      translate: -3px 0;
    }
    40% {
      translate: 3px 0;
    }
    60% {
      translate: -2px 0;
    }
    80% {
      translate: 2px 0;
    }
  }
</style>
