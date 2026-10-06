<script lang="ts">
  // A frame (def.ts): its tabs when it has more than one, and the tab shown below them, drawn by
  // the canvas it sits on (grid/context.ts) and edited there in place, like the desk. Picking a
  // tab only changes what this device shows (`showTab`, never sent or shared). It works in every
  // mode, LOCKED too like the desk tabs, but never while a finger still holds a widget on the tab.
  // Arrow keys step through the tabs (not in EDIT, where they nudge the selected widget).
  //
  // In EDIT the selected widgets' tab is always the one shown, and widgets carried over a tab's
  // name open that tab after a moment, so they can be put down there.
  //
  // The tab is drawn beside the frame, over its empty `tabs.panel` slot, never inside it: skins
  // style a widget's parts through its frame, so a frame around the tab's widgets would reach
  // into them (an "off" rule of the frame matching a switch that is on).
  import { untrack } from 'svelte';
  import { useCanvas } from '../../grid/context';
  import { within } from '../../grid/engine';
  import type { TabsWidget } from '../../model/preset';
  import { tabKey } from '../../model/tabs';
  import { tapHaptic } from '../../platform/haptics';
  import { flag } from '../../skins/anatomy';
  import { presetStore } from '../../state/preset.svelte';
  import { holdsAny } from '../../state/touch';
  import { values } from '../../state/values.svelte';
  import { widgetName } from '../defs';
  import WidgetFrame from '../WidgetFrame.svelte';
  import { shownTab } from './def';

  let { widget, live }: { widget: TabsWidget; live: boolean } = $props();

  /** How long a carried widget waits over a tab's name before it opens. */
  const HOVER_MS = 350;

  /** The canvas it is on; none in LOOK's previews and the gallery (an empty tab then). */
  const canvas = useCanvas();
  const ctx = $derived(canvas?.());

  const tabs = $derived(widget.props.tabs);
  const shown = $derived(shownTab(widget, values[widget.id]));
  const index = $derived(tabs.indexOf(shown));
  const ref = $derived({ widget: widget.id, tab: shown.id });
  const onShown = $derived(ctx?.index.get(tabKey(ref)) ?? []);
  /** Tabs switch whenever the frame is on a desk; in previews, only live. */
  const switchable = $derived(ctx ? true : live);
  /** Arrow keys step through the tabs, but not in EDIT: there they nudge. */
  const stepping = $derived(ctx ? !ctx.editing : live);

  /** The tab the selected widgets are on (all on one), if it is one of this frame's. */
  const selectedTab = $derived.by(() => {
    const id = ctx?.selected[0];
    if (!ctx || !id) return undefined;
    const on = (t: (typeof tabs)[number]) =>
      ctx.index.get(tabKey({ widget: widget.id, tab: t.id }))?.some((w) => w.id === id);
    return tabs.find(on);
  });

  function show(i: number) {
    const tab = tabs[i];
    if (!switchable || !tab || tab === shown) return;
    // A held momentary button must get to send its release first.
    if (holdsAny(new Set(onShown.map((w) => w.id)))) return;
    tapHaptic('light');
    presetStore.showTab(widget.id, tab.id);
  }

  /** A tab picked by hand: with widgets of this frame selected, the frame is selected instead. */
  function pick(i: number) {
    if (ctx && selectedTab && tabs[i] !== selectedTab) ctx.onselect(widget.id);
    show(i);
  }

  function onkeydown(e: KeyboardEvent) {
    if (!stepping || tabs.length < 2) return;
    if (e.key === 'ArrowLeft') show(index - 1);
    else if (e.key === 'ArrowRight') show(index + 1);
    else if (e.key === 'Home') show(0);
    else if (e.key === 'End') show(tabs.length - 1);
    else return;
    e.preventDefault();
  }

  // EDIT: the selected widgets' tab is the one shown, so what nudges, Del and ADD act on is seen.
  $effect(() => {
    const tab = selectedTab;
    if (!ctx?.editing || ctx.drag.lifted || !tab || tab === shown) return;
    untrack(() => presetStore.showTab(widget.id, tab.id));
  });

  // Widgets that may come onto this frame, carried over a tab's name, open that tab after a
  // moment (sweeping across the tabs opens none of them). The pointer is the drag's: a carried
  // widget holds it, so the tabs see none of its events.
  let strip = $state<HTMLDivElement>();
  const tabEls: (HTMLButtonElement | null)[] = [];
  const hovered = $derived.by(() => {
    const lifted = ctx?.drag.lifted;
    const p = ctx?.drag.pointer;
    if (!ctx || !lifted || !ctx.drag.carrying || !p || !strip || !ctx.drag.accepts(lifted, ref))
      return -1;
    // A tab scrolled out of the strip doesn't count.
    if (!within(strip.getBoundingClientRect(), p.x, p.y)) return -1;
    return tabEls.findIndex((el) => el && within(el.getBoundingClientRect(), p.x, p.y));
  });
  $effect(() => {
    const i = hovered;
    if (i < 0 || tabs[i] === shown) return;
    const timer = setTimeout(() => show(i), HOVER_MS);
    return () => clearTimeout(timer);
  });

  // Where the tab's layer goes: over the slot, measured relative to this widget.
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

<div class="tabs-widget" bind:this={root}>
  <WidgetFrame
    {widget}
    {live}
    status={shown.name}
    role="group"
    aria-label={widgetName(widget)}
    tabindex={stepping && tabs.length > 1 ? 0 : -1}
    {onkeydown}
  >
    {#snippet children()}
      <div class="inner">
        {#if tabs.length > 1}
          <div class="list" data-part="tabs.list" role="tablist" bind:this={strip}>
            {#each tabs as tab, i (tab.id)}
              <!-- A press on a tab is the tab's, never a drag of the frame (which would take the
                   pointer, and with it the click). -->
              <button
                type="button"
                class="tab"
                class:switchable
                data-part="tabs.tab"
                data-current={flag(tab === shown)}
                role="tab"
                aria-selected={tab === shown}
                tabindex="-1"
                bind:this={tabEls[i]}
                onpointerdown={(e) => e.stopPropagation()}
                onclick={() => pick(i)}
                ><span class="text" data-part="tabs.text" data-current={flag(tab === shown)}
                  >{tab.name}</span
                ></button
              >
            {/each}
          </div>
        {/if}
        <div class="panel" data-part="tabs.panel" bind:this={slot}>
          {#if onShown.length === 0}<span class="empty" data-part="tabs.empty">empty tab</span>{/if}
        </div>
      </div>
    {/snippet}
  </WidgetFrame>
  {#if ctx && box}
    {@const Tab = ctx.Tab}
    <div
      class="layer"
      style:transform="translate({box.x}px, {box.y}px)"
      style:width="{box.w}px"
      style:height="{box.h}px"
    >
      <Tab tab={ref} />
    </div>
  {/if}
</div>

<style>
  .tabs-widget {
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
    gap: var(--tabs-gap, 2px);
  }
  .list {
    flex: none;
    display: flex;
    gap: var(--tabs-gap, 2px);
    height: var(--tabs-list-h, var(--lh));
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
  .panel {
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
