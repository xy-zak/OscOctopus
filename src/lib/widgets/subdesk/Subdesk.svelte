<script lang="ts">
  // A desk inside the desk (def.ts): a tab per page when it has more than one, and the page
  // shown below them, drawn by the canvas it sits on (grid/context.ts). Picking a tab only
  // changes what this device shows (`showPage`, never sent or shared); it works while LOCKED, like
  // the desk tabs, but never while a finger still holds a widget on the page. Arrow keys step
  // through the tabs.
  //
  // The page is drawn beside the frame, over its empty `subdesk.page` slot, never inside it:
  // skins style a widget's parts through its frame, so a frame around the page's widgets would
  // reach into them (an "off" rule of the sub-desk's frame matching a switch that is on).
  import { useCanvas } from '../../grid/context';
  import type { SubdeskWidget } from '../../model/preset';
  import { pageKey, widgetsUnder } from '../../model/subdesks';
  import { tapHaptic } from '../../platform/haptics';
  import { flag } from '../../skins/anatomy';
  import { presetStore } from '../../state/preset.svelte';
  import { holdsAny } from '../../state/touch';
  import { values } from '../../state/values.svelte';
  import { widgetName } from '../defs';
  import WidgetFrame from '../WidgetFrame.svelte';
  import { shownPage } from './def';

  let { widget, live }: { widget: SubdeskWidget; live: boolean } = $props();

  /** The canvas it is on; none in LOOK's previews and the gallery (an empty page then). */
  const canvas = useCanvas();
  const ctx = $derived(canvas?.());

  const pages = $derived(widget.props.pages);
  const shown = $derived(shownPage(widget, values[widget.id]));
  const index = $derived(pages.indexOf(shown));
  const ref = $derived({ widget: widget.id, page: shown.id });
  const empty = $derived(!ctx || (ctx.index.get(pageKey(ref)) ?? []).length === 0);
  /** Tabs switch whenever the desk isn't being edited. */
  const switchable = $derived(ctx ? !ctx.editing : live);

  function show(i: number) {
    const page = pages[i];
    if (!switchable || !page || page === shown) return;
    // A held momentary button must get to send its release first.
    if (ctx && holdsAny(new Set(widgetsUnder(ctx.preset, ref).map((w) => w.id)))) return;
    tapHaptic('light');
    presetStore.showPage(widget.id, page.id);
  }

  function onkeydown(e: KeyboardEvent) {
    if (!switchable || pages.length < 2) return;
    if (e.key === 'ArrowLeft') show(index - 1);
    else if (e.key === 'ArrowRight') show(index + 1);
    else if (e.key === 'Home') show(0);
    else if (e.key === 'End') show(pages.length - 1);
    else return;
    e.preventDefault();
  }

  // Where the page layer goes: over the slot, measured relative to this widget.
  let root = $state<HTMLDivElement>();
  let slot = $state<HTMLDivElement>();
  let box = $state<{ x: number; y: number; w: number; h: number } | null>(null);
  $effect(() => {
    if (!root || !slot || !ctx) return;
    const outer = root;
    const inner = slot;
    const measure = () => {
      const a = outer.getBoundingClientRect();
      const b = inner.getBoundingClientRect();
      box = { x: b.left - a.left, y: b.top - a.top, w: b.width, h: b.height };
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    observer.observe(inner);
    return () => observer.disconnect();
  });
</script>

<div class="subdesk" bind:this={root}>
  <WidgetFrame
    {widget}
    {live}
    status={shown.name}
    role="group"
    aria-label={widgetName(widget)}
    tabindex={switchable && pages.length > 1 ? 0 : -1}
    {onkeydown}
  >
    {#snippet children()}
      <div class="inner">
        {#if pages.length > 1}
          <div class="tabs" data-part="subdesk.tabs" role="tablist">
            {#each pages as page, i (page.id)}
              <button
                type="button"
                class="tab"
                class:switchable
                data-part="subdesk.tab"
                data-current={flag(page === shown)}
                role="tab"
                aria-selected={page === shown}
                tabindex="-1"
                onclick={() => show(i)}
                ><span class="text" data-part="subdesk.text" data-current={flag(page === shown)}
                  >{page.name}</span
                ></button
              >
            {/each}
          </div>
        {/if}
        <div class="page" data-part="subdesk.page" bind:this={slot}>
          {#if empty}<span class="empty" data-part="subdesk.empty">empty page</span>{/if}
        </div>
      </div>
    {/snippet}
  </WidgetFrame>
  {#if ctx && box}
    {@const Page = ctx.Page}
    <div
      class="layer"
      style:transform="translate({box.x}px, {box.y}px)"
      style:width="{box.w}px"
      style:height="{box.h}px"
    >
      <Page page={ref} />
    </div>
  {/if}
</div>

<style>
  .subdesk {
    position: relative;
    width: 100%;
    height: 100%;
  }
  .layer {
    position: absolute;
    top: 0;
    left: 0;
  }
  .inner {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    gap: var(--subdesk-tab-gap, 2px);
  }
  .tabs {
    flex: none;
    display: flex;
    gap: var(--subdesk-tab-gap, 2px);
    height: var(--subdesk-tabs-h, var(--lh));
    overflow-x: auto;
    overflow-y: hidden;
    touch-action: pan-x;
    scrollbar-width: none;
  }
  .tab {
    position: relative;
    flex: 0 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    padding: 0 1ch;
    white-space: nowrap;
    overflow: hidden;
  }
  .tab.switchable {
    cursor: pointer;
  }
  .text {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .page {
    position: relative;
    flex: 1;
    min-height: 0;
  }
  .empty {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
</style>
