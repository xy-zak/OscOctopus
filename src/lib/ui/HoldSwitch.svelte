<script lang="ts">
  // A master switch that changes only after a deliberate press-and-hold (HOLD_MS), so a stray
  // touch during a show can't flip it: on and off alike (OSC-IN, OSC-OUT), or only off
  // (`holdOff`: FREEZE and PRESENT turn on with a click, so the safe state is one tap away). While holding, the button wipes into its next
  // state in ten pixel columns; a release before HOLD_MS cancels and flashes a "HOLD 1 SEC"
  // hint so it's clear what to do.
  //
  // Robustness: the button has a fixed width (the label never changes its size, so the
  // pointer can't end up outside it), and the hold is measured from the press time, so a
  // release after HOLD_MS changes it even if the timer was delayed. Keyboard: focus it and hold
  // Space/Enter, or hold its Alt shortcut (App.svelte calls press, release and cancel).
  import { tapHaptic } from '../platform/haptics';
  import { switchBox } from './ToggleSwitch.svelte';

  /** Fills from app.css: `accent` (on), `warn` (FREEZE's safety state), `alarm` (red outline). */
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
    /** Its tooltip (a mouse or the keyboard: its long press is its own). */
    tip: string;
    /** Bumped whenever someone touches something this switch holds: the button nudges and hints. */
    nudge?: number;
    /** Only turning off needs the hold; turning on is a click. */
    holdOff?: boolean;
    /** Its `data-tour` id: what a step of the tour highlights (lib/tour/steps.ts). */
    tour?: string;
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
    tip,
    nudge = 0,
    holdOff = false,
    tour,
  }: Props = $props();

  const HOLD_MS = 1000;
  const HINT_MS = 1800;
  /** How long the next state stays shown while waiting for the change to land. */
  const LAND_MS = 3000;
  let holding = $state(false);
  /** A press that changes on release, without a hold (`holdOff` while off). */
  let tapping = false;
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

  /** Starts a hold (or, when this change needs none, a click). */
  export function press() {
    if (holding || tapping || landing) return;
    if (holdOff && !on) {
      tapping = true;
      return;
    }
    holding = true;
    hint = false;
    pressedAt = performance.now();
    clearTimeout(timer);
    timer = setTimeout(commit, HOLD_MS);
  }

  /** Ends a hold: changes the switch if it lasted HOLD_MS, else hints. */
  export function release() {
    if (tapping) {
      tapping = false;
      commit();
      return;
    }
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
    tapping = false;
  }

  // A switch that goes away must not change anything later.
  $effect(() => () => {
    clearTimeout(timer);
    clearTimeout(hintTimer);
    clearTimeout(landTimer);
  });

  // Same anatomy as the other switches (ToggleSwitch): [■] when on.
  const box = $derived(hint && !holding ? '' : switchBox(on));
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
  aria-label={holdOff && !on
    ? label
    : `${label}: press and hold for one second to ${holdOff ? 'turn off' : 'change'}`}
  data-tip={tip}
  data-tip-touch="off"
  data-tour={tour}
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
    ><span class="box">{switchBox(!on)}</span>{on ? label : onLabel}</span
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
  /* Hint after a short tap (or a touch on a frozen widget): shake, and say what to do. */
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
