<script lang="ts">
  // Shared shell of every widget: the frame, with the title and an optional status readout
  // (value) set into its border (labels.ts). Where they go is the same in every skin; how they
  // look is the skin's (skins/terminal.css, …): this only lays out the parts and marks their
  // state (see skins/anatomy.ts). Widgets pass their own state attributes (data-on, …) via
  // `rest`.
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { flag } from '../skins/anatomy';
  import { useSkin } from '../skins/context';
  import { colorVars } from '../theme/palettes';
  import { charWidth } from '../ui/textfit';
  import { labelLayout } from './labels';

  interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'color' | 'children' | 'title'> {
    /** The widget type, for skins and cursors (`data-type`). */
    type: string;
    /** Takes input (not editing, not LOCKED). */
    live?: boolean;
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
    type,
    live = false,
    title = '',
    status = '',
    color,
    active = false,
    pressed = false,
    element = $bindable(),
    children,
    ...rest
  }: Props = $props();

  let w = $state(0);
  let h = $state(0);
  const colors = $derived(colorVars(color));
  const skin = useSkin();

  const layout = $derived(labelLayout(title, status, w, h, charWidth()));
</script>

<div
  bind:this={element}
  bind:clientWidth={w}
  bind:clientHeight={h}
  class="frame"
  data-part="frame"
  data-type={type}
  data-base={skin().base}
  data-skin={skin().id}
  data-live={flag(live)}
  data-active={flag(active)}
  data-pressed={flag(pressed)}
  style:--c={colors.c}
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
      >{status}</span
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
  }
  .body {
    position: absolute;
    inset: var(--frame-inset-t, 9px) var(--frame-inset-x, 7px) var(--frame-inset-b, 7px);
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
