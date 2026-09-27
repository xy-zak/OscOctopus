<script lang="ts">
  // A master switch that changes only after a deliberate press-and-hold (HOLD_MS), on and off
  // alike, so a stray touch during a show can't flip it (LOCK, OSC-IN, OSC-OUT). While holding,
  // the button wipes into its next state in ten pixel columns; a release before HOLD_MS
  // cancels and flashes a "HOLD 1 SEC" hint so it's clear what to do.
  //
  // Robustness: the button has a fixed width (the label never changes its size, so the
  // pointer can't end up outside it), and the hold is measured from the press time, so a
  // release after HOLD_MS changes it even if the timer was delayed. Keyboard: focus it and hold
  // Space/Enter, or hold its Alt shortcut (App.svelte calls press, release and cancel).
  import { tapHaptic } from '../platform/haptics';

  /** Fills from app.css: `accent` (on), `warn` (LOCK's safety state), `alarm` (red outline). */
  type Tone = 'accent' | 'warn' | 'alarm' | '';

  interface Props {
    on: boolean;
    onchange: (on: boolean) => void;
    label: string;
    /** The label while on (default: `label`). */
    onLabel?: string;
    onTone?: Tone;
    offTone?: Tone;
    /** For a longer label (.mbtn.switch.wide). */
    wide?: boolean;
    /** Blink the box while off (OSC-OUT: off is a safety state). */
    blinkOff?: boolean;
    title: string;
    /** Bumped whenever someone touches something this switch holds: the button nudges and hints. */
    nudge?: number;
  }
  let {
    on,
    onchange,
    label,
    onLabel = label,
    onTone = 'accent',
    offTone = '',
    wide = false,
    blinkOff = false,
    title,
    nudge = 0,
  }: Props = $props();

  const HOLD_MS = 1000;
  const HINT_MS = 1800;
  /** How long the next state stays shown while waiting for the change to land. */
  const LAND_MS = 3000;
  let holding = $state(false);
  let hint = $state(false);
  let landing = $state(false);
  let pressedAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let hintTimer: ReturnType<typeof setTimeout> | undefined;
  let landTimer: ReturnType<typeof setTimeout> | undefined;

  function showHint() {
    hint = true;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => (hint = false), HINT_MS);
  }

  $effect(() => {
    if (nudge > 0) showHint();
  });

  // OSC-IN and OSC-OUT change once the core confirms, so after a hold the next state stays
  // shown until `on` really changes (or LAND_MS passes, if the change failed).
  $effect(() => {
    void on;
    landing = false;
    clearTimeout(landTimer);
  });

  function commit() {
    clearTimeout(timer);
    holding = false;
    hint = false;
    landing = true;
    landTimer = setTimeout(() => (landing = false), LAND_MS);
    tapHaptic('heavy');
    onchange(!on);
  }

  /** Starts a hold. */
  export function press() {
    if (holding || landing) return;
    holding = true;
    hint = false;
    pressedAt = performance.now();
    clearTimeout(timer);
    timer = setTimeout(commit, HOLD_MS);
  }

  /** Ends a hold: changes the switch if it lasted HOLD_MS, else hints. */
  export function release() {
    if (!holding) return;
    clearTimeout(timer);
    if (performance.now() - pressedAt >= HOLD_MS) commit();
    else {
      holding = false;
      showHint();
    }
  }

  /** Drops a hold without changing anything (pointer cancelled, window left). */
  export function cancel() {
    clearTimeout(timer);
    holding = false;
  }

  // Same anatomy as the other master switches: [■] when on.
  const box = $derived(hint && !holding ? '' : `[${on ? '■' : ' '}]`);
  // The label stays put while holding, so the next state's wipes over it in line.
  const text = $derived(hint ? 'HOLD 1 SEC' : on ? onLabel : label);
</script>

<button
  type="button"
  class="mbtn switch hold {on ? onTone : offTone}"
  class:wide
  class:holding
  class:landing
  class:hint
  style:--hold="{HOLD_MS}ms"
  role="switch"
  aria-checked={on}
  aria-label="{label}: press and hold for one second to change"
  {title}
  onpointerdown={(e) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    press();
  }}
  onpointerup={release}
  onpointercancel={cancel}
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
  <span class="label"
    >{#if box}<span class="box" class:blink={blinkOff && !on}>{box}</span>{/if}{text}</span
  >
  <!-- The next state, wiped in over the button while holding. -->
  <span class="next mbtn {on ? offTone : onTone}" aria-hidden="true"
    ><span class="box">[{on ? ' ' : '■'}]</span>{on ? label : onLabel}</span
  >
</button>

<style>
  /* The shape comes from .mbtn (app.css); the width is fixed there too, so the label can
     change while the pointer stays inside. No colour transition: the wipe is the change. */
  .hold {
    position: relative;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    transition: none;
  }
  .label {
    display: inline-flex;
    gap: 1ch;
  }
  /* Over the whole button, border included; hidden until a hold reveals it left to right. */
  .next {
    position: absolute;
    inset: -1px;
    width: auto;
    height: auto;
    transition: none;
    clip-path: inset(0 100% 0 0);
    pointer-events: none;
  }
  .holding .next,
  .landing .next {
    clip-path: inset(0);
  }
  .holding .next {
    transition: clip-path var(--hold) steps(10, end);
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
