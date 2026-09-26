<script lang="ts">
  // Shared shell of every widget: a 1px TUI frame with the title set into the border, an
  // optional status readout (value) set into the border too, and a hard pixel shadow the
  // widget sinks into when pressed.
  //
  // Text placement follows one rule: horizontal if it fits, otherwise vertical along a side
  // border, otherwise hidden. The font size never changes.
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { colorVars } from '../theme/palettes';
  import { charWidth, fitsIn } from '../ui/textfit';

  interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'color' | 'children' | 'title'> {
    title?: string;
    status?: string;
    color: number | null;
    /** Border + title take the widget colour (being touched, switched on, ...). */
    active?: boolean;
    /** Sink into the shadow. */
    pressed?: boolean;
    element?: HTMLDivElement;
    children: Snippet<[{ w: number; h: number }]>;
  }
  let {
    title = '',
    status = '',
    color,
    active = false,
    pressed = false,
    element = $bindable(),
    children,
    class: klass = '',
    ...rest
  }: Props = $props();

  let w = $state(0);
  let h = $state(0);
  const colors = $derived(colorVars(color));

  // Border length available for text: minus a corner + gap at each end.
  const layout = $derived.by(() => {
    const ch = charWidth();
    const across = w - 3 * ch;
    const down = h - 3 * ch;
    const tLen = title ? Array.from(title).length + 2 : 0;
    const sLen = status ? Array.from(status).length + 2 : 0;
    let titlePos: 'top' | 'left' | 'none' = 'none';
    if (title) {
      if (fitsIn(title, across, ch)) titlePos = 'top';
      else if (fitsIn(title, down, ch)) titlePos = 'left';
      else if (across >= 6 * ch) titlePos = 'top'; // truncated with an ellipsis
    }
    let statusPos: 'top' | 'bottom' | 'right' | 'none' = 'none';
    if (status) {
      if (titlePos === 'top' && (tLen + sLen + 1) * ch <= across) statusPos = 'top';
      else if (!title && fitsIn(status, across, ch)) statusPos = 'top';
      else if (fitsIn(status, across, ch)) statusPos = 'bottom';
      else if (fitsIn(status, down, ch)) statusPos = 'right';
    }
    return { titlePos, statusPos };
  });
</script>

<div
  bind:this={element}
  bind:clientWidth={w}
  bind:clientHeight={h}
  class="frame {klass}"
  class:active
  class:pressed
  style:--c={colors.c}
  {...rest}
>
  <div class="body">{@render children({ w, h })}</div>
  {#if layout.titlePos !== 'none'}
    <span class="title {layout.titlePos}" class:full={layout.statusPos !== 'top'}>{title}</span>
  {/if}
  {#if layout.statusPos !== 'none'}
    <span class="status {layout.statusPos}">{status}</span>
  {/if}
</div>

<style>
  /* Colour roles, shared by every widget:
       --c        the widget's own colour, for lines and dots (border, tracks, key edges)
       --c-solid  --c slightly faded into the background, for solid areas (faces, blocks, caps);
                  the ACTIVE green is never faded
       --c-ink    text on a --c-solid fill: the plain foreground, since a half-faded colour
                  sits close to the background in either mode
       --c-text   --c used as text (darkened in light mode, see tokens.css --accent-text)
       --w-bg     the widget's background: a neutral grey, whatever its colour
       --act      the app-wide ACTIVE green: pressed, on, filled, held
       --act-ink  text on an --act fill */
  .frame {
    --c-text: var(--c);
    --w-bg: color-mix(in srgb, var(--fg) 8%, var(--bg-2));
    --c-solid: color-mix(in srgb, var(--c) 50%, var(--w-bg));
    --c-ink: var(--fg);
    --act: var(--active);
    --act-ink: var(--active-ink);
    position: relative;
    width: 100%;
    height: 100%;
    border: 1px solid var(--c);
    background: var(--w-bg);
    box-shadow: 4px 4px 0 0 var(--shadow-px);
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    transition:
      translate var(--t-release) var(--ease-spring),
      box-shadow var(--t-release) var(--ease-spring),
      border-color var(--t-ui) steps(2);
  }
  :global(:root[data-mode='light']) .frame {
    --c-text: color-mix(in srgb, var(--c) 50%, #000);
  }
  .frame.active {
    border-color: var(--act);
  }
  .frame.pressed {
    translate: 3px 3px;
    box-shadow: 1px 1px 0 0 var(--shadow-px);
    transition-duration: var(--t-press);
  }
  .body {
    position: absolute;
    inset: 9px 7px 7px;
    overflow: hidden;
  }

  /* Text set into the border: a background patch "cuts" the line behind it. */
  .title,
  .status {
    position: absolute;
    padding: 0 1ch;
    line-height: 1;
    background: var(--bg);
    white-space: nowrap;
    pointer-events: none;
    transition: color var(--t-ui) steps(2);
  }
  .title {
    color: var(--fg);
    font-weight: 700;
    text-transform: uppercase;
  }
  .active .title {
    color: var(--act);
  }
  .status {
    color: var(--fg-dim);
  }
  .active .status {
    color: var(--fg);
  }
  .title.top {
    top: 0;
    left: 1ch;
    translate: 0 -50%;
    max-width: calc(100% - 2ch);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .title.top:not(.full) {
    max-width: 55%;
  }
  .status.top {
    top: 0;
    right: 1ch;
    translate: 0 -50%;
  }
  .status.bottom {
    bottom: 0;
    right: 1ch;
    translate: 0 50%;
  }
  /* Vertical text reads bottom-to-top, like a spine. */
  .title.left,
  .status.right {
    writing-mode: vertical-rl;
    padding: 1ch 0;
  }
  .title.left {
    left: 0;
    bottom: 1ch;
    transform: translateX(-50%) rotate(180deg);
  }
  .status.right {
    right: 0;
    top: 1ch;
    transform: translateX(50%) rotate(180deg);
  }
</style>
