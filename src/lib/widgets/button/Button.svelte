<script lang="ts">
  // A raised key (see Keycap) with a face in the widget colour: press sinks the cap back into
  // the panel and turns the face ACTIVE green; release pops it back out and dissolves the green
  // through two dither steps.
  //
  // Arm-then-fire (props.arm), for cues where a stray tap is costly:
  //   double: the first press only ARMS (dithered, blinking, "ARMED" in the border) for
  //           armTimeoutMs; a second press fires. Letting the timeout run out disarms.
  //   hold:   press and keep holding for holdMs while a fill steps up the key; it fires
  //           when full. Letting go early cancels.
  // Nothing is sent until it fires.
  import type { ButtonWidget } from '../../model/preset';
  import { emitValue } from '../../osc/sender';
  import { tapHaptic } from '../../platform/haptics';
  import { fitsIn } from '../../ui/textfit';
  import { numberValue } from '../../state/values.svelte';
  import Keycap from '../Keycap.svelte';
  import WidgetFrame from '../WidgetFrame.svelte';

  let { widget, live }: { widget: ButtonWidget; live: boolean } = $props();

  // Several fingers on one button count as a single press.
  const pointers = new Set<number>();
  let pressed = $state(false);
  // Bumped on every release so the dissolve animation restarts.
  let releases = $state(0);
  /** This press actually fired (so a momentary release sends the off value). */
  let fired = $state(false);
  let armed = $state(false);
  let holding = $state(false);
  let armTimer: ReturnType<typeof setTimeout> | undefined;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;

  const p = $derived(widget.props);
  const shown = $derived(numberValue(widget.id, p.offValue));
  const ARMED_HINT = '[ TAP TO FIRE ]';

  function fire() {
    fired = true;
    tapHaptic(p.arm === 'none' ? 'medium' : 'heavy');
    emitValue(widget.id, p.onValue, true);
  }

  function disarm() {
    armed = false;
    clearTimeout(armTimer);
  }

  function press() {
    pressed = true;
    fired = false;
    if (p.arm === 'double') {
      if (!armed) {
        armed = true;
        tapHaptic('light');
        clearTimeout(armTimer);
        armTimer = setTimeout(disarm, p.armTimeoutMs);
        return;
      }
      disarm();
      fire();
    } else if (p.arm === 'hold') {
      holding = true;
      tapHaptic('light');
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => {
        holding = false;
        fire();
      }, p.holdMs);
    } else {
      fire();
    }
  }

  function release() {
    pressed = false;
    clearTimeout(holdTimer);
    holding = false;
    if (fired) {
      releases++;
      if (p.mode === 'momentary') emitValue(widget.id, p.offValue, true);
    }
    fired = false;
  }

  // Disarm when the arm setting changes or the widget stops being live (edit mode, LOCK).
  $effect(() => {
    void p.arm;
    if (!live) {
      disarm();
      clearTimeout(holdTimer);
      holding = false;
    }
  });
  // A removed widget must not fire from a pending hold or arm timer.
  $effect(() => () => {
    clearTimeout(armTimer);
    clearTimeout(holdTimer);
  });

  const status = $derived(
    armed
      ? 'ARMED'
      : holding
        ? 'HOLD…'
        : `${p.arm === 'double' ? '2× ' : p.arm === 'hold' ? 'HOLD ' : ''}${p.mode === 'trigger' ? 'TRIG ' : ''}${shown}`,
  );

  function onpointerdown(e: PointerEvent) {
    if (!live) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.add(e.pointerId);
    if (pointers.size === 1) press();
  }

  function onpointerup(e: PointerEvent) {
    if (!pointers.delete(e.pointerId) || pointers.size > 0) return;
    release();
  }

  function onkeydown(e: KeyboardEvent) {
    if (!live || e.repeat || (e.key !== ' ' && e.key !== 'Enter')) return;
    e.preventDefault();
    press();
  }

  function onkeyup(e: KeyboardEvent) {
    if (!live || (e.key !== ' ' && e.key !== 'Enter')) return;
    release();
  }
</script>

<WidgetFrame
  class="button {live ? 'live' : ''}"
  title={widget.label}
  color={widget.color}
  {status}
  active={fired || armed || holding}
  role="button"
  aria-label={widget.label}
  tabindex={live ? 0 : -1}
  {onpointerdown}
  {onpointerup}
  onpointercancel={onpointerup}
  {onkeydown}
  {onkeyup}
>
  {#snippet children({ w })}
    <!-- The name sits in the border like every other widget's. Inside is a key cap standing
         out of the panel towards you; pressing sinks it back. -->
    <div class="key" class:lit={fired || armed || holding}>
      <Keycap depth={16} down={pressed}>
        {#key releases}
          <span class="fill" class:on={pressed && fired} class:dissolve={!fired && releases > 0}
          ></span>
        {/key}
        {#if armed}<span class="armed" aria-hidden="true"></span>{/if}
        {#if holding}<span class="hold" style:--hold="{p.holdMs}ms" aria-hidden="true"></span>{/if}
        {#if armed && fitsIn(ARMED_HINT, w * 0.7)}<span class="label">{ARMED_HINT}</span>{/if}
      </Keycap>
    </div>
  {/snippet}
</WidgetFrame>

<style>
  :global(.frame.button.live) {
    cursor: pointer;
  }
  /* At rest the key is the widget colour: a solid face with shaded sides. */
  .key {
    --key-edge: var(--c);
    --key-dots: color-mix(in srgb, var(--c) 55%, transparent);
    --key-face: var(--c-solid);
    position: absolute;
    inset: 0;
  }
  /* Lit (fired, armed, holding): lines and shading turn the ACTIVE green. */
  .key.lit {
    --key-edge: var(--act);
    --key-dots: color-mix(in srgb, var(--act) 55%, transparent);
  }
  /* ARMED: a blinking dithered wash; the next press fires. */
  .armed {
    position: absolute;
    inset: 0;
    background: var(--dither-50-act);
    animation: armed-blink 0.6s steps(1) infinite;
  }
  @keyframes armed-blink {
    50% {
      opacity: 0.25;
    }
  }
  /* HOLD: a fill steps up the key; it fires when full. */
  .hold {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 100%;
    background: var(--act);
    transform-origin: bottom;
    animation: hold-fill var(--hold) steps(10, end) forwards;
  }
  @keyframes hold-fill {
    from {
      transform: scaleY(0);
    }
    to {
      transform: scaleY(1);
    }
  }
  .fill {
    position: absolute;
    inset: 0;
  }
  /* Pressed: the face goes ACTIVE green. */
  .fill.on {
    background: var(--act);
  }
  /* Pixel dissolve back to the widget colour: solid → 50% dither → 25% dither → gone. */
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
  /* ARMED hint, centred on the key. */
  .label {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-weight: 700;
    white-space: nowrap;
    color: var(--c-ink);
  }
</style>
