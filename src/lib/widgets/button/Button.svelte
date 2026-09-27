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
  //
  // Driven from outside (incoming OSC, a sync peer), it only shows state: a momentary button
  // lights while its value is the on value, and a trigger button flashes once per fire. That
  // never arms, fires or sends anything here.
  import type { ButtonWidget } from '../../model/preset';
  import { emitValue } from '../../osc/flow';
  import { tapHaptic } from '../../platform/haptics';
  import { flag } from '../../skins/anatomy';
  import { feedback } from '../../state/feedback.svelte';
  import { numberValue } from '../../state/values.svelte';
  import { fitsIn } from '../../ui/textfit';
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
  /** A momentary button held down elsewhere (its value is the on value, not pressed here). */
  const remoteOn = $derived(
    p.mode === 'momentary' && !pressed && p.onValue !== p.offValue && shown === p.onValue,
  );
  /** Restarts the release dissolve: local releases plus fires from outside. */
  const flashKey = $derived(releases + (feedback.flash[widget.id] ?? 0));
  const lit = $derived(fired || armed || holding || remoteOn);
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
  type="button"
  {live}
  title={widget.label}
  color={widget.color}
  {status}
  active={lit}
  data-lit={flag(lit)}
  data-armed={flag(armed)}
  data-holding={flag(holding)}
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
    <div class="key" data-part="button.key">
      <Keycap depth={16} down={pressed || remoteOn}>
        {#key flashKey}
          <span
            class="fill"
            data-part="button.fill"
            data-on={flag((pressed && fired) || remoteOn)}
            data-flash={flag(!fired && !remoteOn && flashKey > 0)}
          ></span>
        {/key}
        {#if armed}<span class="armed" data-part="button.armed" aria-hidden="true"></span>{/if}
        {#if holding}<span
            class="hold"
            data-part="button.hold"
            style:--hold="{p.holdMs}ms"
            aria-hidden="true"
          ></span>{/if}
        {#if armed && fitsIn(ARMED_HINT, w * 0.7)}<span class="label" data-part="button.hint"
            >{ARMED_HINT}</span
          >{/if}
      </Keycap>
    </div>
  {/snippet}
</WidgetFrame>

<style>
  :global(.frame[data-type='button'][data-live]) {
    cursor: pointer;
  }
  .key,
  .fill,
  .armed {
    position: absolute;
    inset: 0;
  }
  /* The hold fill covers the key; the skin reveals it from the bottom as the hold runs. */
  .hold {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 100%;
  }
  /* ARMED hint, centred on the key. */
  .label {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    white-space: nowrap;
  }
</style>
