<script lang="ts">
  // The app's one tooltip (mounted once, in App). Any element with a `data-tip` has one: hover
  // it with a mouse, focus it with the keyboard, or press and hold it with a finger (tooltip.ts
  // says when). `data-tip-touch="off"` keeps a long press for the element itself (HoldSwitch).
  // Native `title`s aren't used in the app's chrome, so a tip never shows twice.
  import { onMount } from 'svelte';
  import { placeTip, TipController, type Shown, type TipTarget } from './tooltip';

  let shown = $state.raw<Shown | null>(null);
  let el = $state<HTMLDivElement>();
  let pos = $state({ left: 0, top: 0 });
  const id = $props.id();

  /** The same element is always the same target, so a hover over its children doesn't restart. */
  const targets = new WeakMap<Element, TipTarget>();
  function targetOf(node: EventTarget | null): TipTarget | null {
    const host = node instanceof Element ? node.closest<HTMLElement>('[data-tip]') : null;
    const text = host?.dataset.tip?.trim();
    if (!host || !text) return null;
    let t = targets.get(host);
    if (!t) {
      t = { key: host, text, box: () => host.getBoundingClientRect(), longPress: true };
      targets.set(host, t);
    }
    // Read fresh each time: the text and the hold rule can change with state.
    t.text = text;
    t.longPress = host.dataset.tipTouch !== 'off';
    return t;
  }

  let described: Element | null = null;
  const tips = new TipController((s) => {
    described?.removeAttribute('aria-describedby');
    described = null;
    shown = s;
    if (s) {
      described = s.target.key as Element;
      described.setAttribute('aria-describedby', id);
    }
  });

  // Placed once its size is known: centred above what it points at, kept on screen.
  $effect(() => {
    if (!shown || !el) return;
    const r = el.getBoundingClientRect();
    pos = placeTip(
      shown.at,
      { width: r.width, height: r.height },
      { width: innerWidth, height: innerHeight },
      shown.via === 'touch' ? 24 : 6,
    );
  });

  const info = (e: PointerEvent) => ({ pointerType: e.pointerType, x: e.clientX, y: e.clientY });

  onMount(() => {
    const opts = { capture: true, passive: true } as const;
    const over = (e: PointerEvent) => tips.hover(targetOf(e.target), info(e));
    const down = (e: PointerEvent) => tips.down(targetOf(e.target), info(e));
    const move = (e: PointerEvent) => tips.move(info(e));
    const up = () => {
      if (!tips.up()) return;
      // The long press showed a tip: the click it would make isn't one.
      const swallow = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
      };
      addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => removeEventListener('click', swallow, { capture: true }), 400);
    };
    const cancel = () => tips.up();
    const focusin = (e: FocusEvent) => {
      const node = e.target instanceof Element ? e.target : null;
      tips.focus(targetOf(node), !!node?.matches(':focus-visible'));
    };
    const focusout = () => tips.blur();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && tips.dismiss();
    const dismiss = () => tips.dismiss();
    // A long press must not open the system's menu or start selecting text.
    const menu = (e: Event) => {
      if (shown?.via === 'touch') e.preventDefault();
    };
    addEventListener('pointerover', over, opts);
    addEventListener('pointerdown', down, opts);
    addEventListener('pointermove', move, opts);
    addEventListener('pointerup', up, opts);
    addEventListener('pointercancel', cancel, opts);
    addEventListener('focusin', focusin, opts);
    addEventListener('focusout', focusout, opts);
    addEventListener('keydown', key, opts);
    addEventListener('scroll', dismiss, opts);
    addEventListener('blur', dismiss, opts);
    addEventListener('contextmenu', menu, { capture: true });
    return () => {
      tips.dismiss();
      removeEventListener('pointerover', over, opts);
      removeEventListener('pointerdown', down, opts);
      removeEventListener('pointermove', move, opts);
      removeEventListener('pointerup', up, opts);
      removeEventListener('pointercancel', cancel, opts);
      removeEventListener('focusin', focusin, opts);
      removeEventListener('focusout', focusout, opts);
      removeEventListener('keydown', key, opts);
      removeEventListener('scroll', dismiss, opts);
      removeEventListener('blur', dismiss, opts);
      removeEventListener('contextmenu', menu, { capture: true });
    };
  });
</script>

{#if shown}
  <div
    bind:this={el}
    {id}
    class="tip"
    role="tooltip"
    style:left="{pos.left}px"
    style:top="{pos.top}px"
  >
    {shown.target.text}
  </div>
{/if}

<style>
  .tip {
    position: fixed;
    z-index: 300;
    max-width: min(48ch, calc(100vw - 8px));
    padding: 2px 1ch;
    border: 1px solid var(--line-strong);
    background: var(--bg-3);
    color: var(--fg);
    box-shadow: 2px 2px 0 0 var(--shadow-px);
    white-space: pre-line;
    overflow-wrap: anywhere;
    pointer-events: none;
    animation: tip-in var(--t-ui) steps(2, end);
  }
  @keyframes tip-in {
    from {
      opacity: 0;
    }
  }
</style>
