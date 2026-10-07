<script lang="ts">
  // Shared shell of every widget: the frame, with the title (its label) and an optional status
  // readout (value) set into its border (labels.ts), unless the widget hides them (`show`).
  // A label is centred on the border, so half of it hangs outside the frame: never more than
  // half the grid's gap (`--label-room`, GridCanvas), so it can't reach the next widget's
  // labels. With a smaller gap it moves inward, over the widget itself, and the body moves
  // aside to keep it clear.
  // Where they go is the same in every skin; how they look is the skin's (skins/terminal.css,
  // …): this only lays out the parts and marks their state (see skins/anatomy.ts). Widgets
  // pass their own state attributes (data-on, …) via `rest`.
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import type { Widget } from '../model/preset';
  import { flag } from '../skins/anatomy';
  import { useSkin } from '../skins/context';
  import { colorVars } from '../theme/palettes';
  import { charWidth } from '../ui/textfit';
  import { labelLayout } from './labels';

  interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
    /** Its type (`data-type`, for skins and cursors), label, colour and what it shows. */
    widget: Widget;
    /** Takes input (not editing, not FROZEN). */
    live?: boolean;
    status?: string;
    /** Border + title take the widget colour (being touched, switched on, ...). */
    active?: boolean;
    /** Sink into the shadow. */
    pressed?: boolean;
    element?: HTMLDivElement;
    children: Snippet<[{ w: number; h: number }]>;
  }
  let {
    widget,
    live = false,
    status = '',
    active = false,
    pressed = false,
    element = $bindable(),
    children,
    ...rest
  }: Props = $props();

  let w = $state(0);
  let h = $state(0);
  const colors = $derived(colorVars(widget.color));
  const skin = useSkin();

  const title = $derived(widget.show.title ? widget.label : '');
  const shownStatus = $derived(widget.show.value ? status : '');
  const layout = $derived(labelLayout(title, shownStatus, w, h, charWidth()));
  /** Which borders carry a label (1) or not (0): the body keeps clear of what moves inward. */
  const on = (side: boolean) => (side ? 1 : 0);
</script>

<div
  bind:this={element}
  bind:clientWidth={w}
  bind:clientHeight={h}
  class="frame"
  data-part="frame"
  data-type={widget.type}
  data-base={skin().base}
  data-skin={skin().id}
  data-live={flag(live)}
  data-active={flag(active)}
  data-pressed={flag(pressed)}
  style:--c={colors.c}
  style:--label-t={on(layout.titlePos === 'top' || layout.statusPos === 'top')}
  style:--label-b={on(layout.statusPos === 'bottom')}
  style:--label-l={on(layout.titlePos === 'left')}
  style:--label-r={on(layout.statusPos === 'right')}
  {...rest}
>
  <div class="body" data-part="frame.body">{@render children({ w, h })}</div>
  {#if layout.titlePos !== 'none'}
    <span
      class="title {layout.titlePos}"
      class:full={layout.statusPos !== 'top'}
      data-part="frame.title"
      data-pos={layout.titlePos}>{title}</span
    >
  {/if}
  {#if layout.statusPos !== 'none'}
    <span class="status {layout.statusPos}" data-part="frame.status" data-pos={layout.statusPos}
      >{shownStatus}</span
    >
  {/if}
</div>

<style>
  .frame {
    position: relative;
    width: 100%;
    height: 100%;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    /* How far a label (1em across its line) hangs outside: half of it, at most half the gap.
       Left unset (outside a grid: previews, the gallery), it is centred on the border. The em
       resolves on the label itself. */
    --label-out: min(0.5em, var(--label-room, 0.5em));
    /* How much further in than centred a label sits, and so how far the body moves aside. */
    --label-in: calc(0.5em - var(--label-out));
  }
  .body {
    position: absolute;
    inset: calc(var(--frame-inset-t, 9px) + var(--label-t) * var(--label-in))
      calc(var(--frame-inset-x, 7px) + var(--label-r) * var(--label-in))
      calc(var(--frame-inset-b, 7px) + var(--label-b) * var(--label-in))
      calc(var(--frame-inset-x, 7px) + var(--label-l) * var(--label-in));
    overflow: hidden;
  }

  /* Text set into the border (the skin gives it a patch that "cuts" the line behind it). */
  .title,
  .status {
    position: absolute;
    padding: 0 1ch;
    line-height: 1;
    white-space: nowrap;
    pointer-events: none;
  }
  .title.top {
    top: 0;
    left: 1ch;
    translate: 0 calc(-1 * var(--label-out));
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
    translate: 0 calc(-1 * var(--label-out));
  }
  .status.bottom {
    bottom: 0;
    right: 1ch;
    translate: 0 var(--label-out);
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
    transform: translateX(calc(-1 * var(--label-out))) rotate(180deg);
  }
  .status.right {
    right: 0;
    top: 1ch;
    transform: translateX(var(--label-out)) rotate(180deg);
  }
</style>
