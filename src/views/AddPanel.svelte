<script lang="ts">
  // Edit-mode panel for adding widgets: each widget type drawn as it would be added, in this
  // desk's skin and colours (skins/preview.ts `ADD_PREVIEWS`, as LOOK draws its skins). Drag one
  // onto the desk or into a frame to add it there (the desk's drag, grid/drag.svelte.ts: the grid
  // it would land on shows where); click one, or press Enter on it, to add it where ADD puts it
  // (`presetStore.addingTo`): on the desk, on the tab a selected frame shows, or beside the
  // selected widgets on their tab. A new widget is selected; the panel stays on ADD.
  import type { DragSession } from '../lib/grid/drag.svelte';
  import type { WidgetType } from '../lib/model/preset';
  import { autoColorOn, tabAt } from '../lib/model/tabs';
  import { tapHaptic } from '../lib/platform/haptics';
  import { ADD_PREVIEWS } from '../lib/skins/preview';
  import SkinScope from '../lib/skins/SkinScope.svelte';
  import { lookStore } from '../lib/state/look.svelte';
  import { presetStore } from '../lib/state/preset.svelte';
  import { colorVars } from '../lib/theme/palettes';
  import { DEFS, WIDGET_TYPES, widgetName } from '../lib/widgets/defs';
  import { viewsOf } from '../lib/widgets/registry';
  import WidgetHeader from './widget/WidgetHeader.svelte';

  let { drag }: { drag: DragSession } = $props();

  const TAP_SLOP = 5;

  const desk = $derived(presetStore.current);
  /** The frame tab a click adds to, if not the desk. */
  const onTab = $derived.by(() => {
    const at = presetStore.addingTo;
    return at ? tabAt(desk, at) : undefined;
  });
  // AUTO widgets take the colour of where they would go: the desk's, or the frame's.
  const auto = $derived(colorVars(autoColorOn(desk, presetStore.addingTo)));
  /** The widget type being brought in, if one is. */
  const bringing = $derived(drag.lifted?.kind === 'add' ? drag.lifted.type : null);

  // A press on a drawing: past the tap slop it becomes a drag, which the desk's drag then follows
  // (it lets go of the pointer, so the drop's events reach the desk); else a click adds it.
  let press: { pointerId: number; x0: number; y0: number; type: WidgetType } | null = null;
  let dragged = false;

  function down(e: PointerEvent, type: WidgetType) {
    dragged = false;
    if (e.button !== 0 || drag.lifted) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    press = { pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, type };
  }

  function move(e: PointerEvent) {
    if (!press || e.pointerId !== press.pointerId) return;
    if (Math.hypot(e.clientX - press.x0, e.clientY - press.y0) < TAP_SLOP) return;
    const { pointerId, type } = press;
    press = null;
    dragged = true;
    (e.currentTarget as HTMLElement).releasePointerCapture(pointerId);
    tapHaptic('light');
    drag.lift({ kind: 'add', type, size: DEFS[type].defaultSize, pointerId }, e.clientX, e.clientY);
  }

  function add(type: WidgetType) {
    // A drag let go over its own drawing adds nothing.
    if (dragged) dragged = false;
    else presetStore.addWidget(type);
  }
</script>

{#snippet drawing(type: WidgetType)}
  {@const p = ADD_PREVIEWS[type]}
  {@const Widget = viewsOf(p.widget).component}
  <span class="stage" style:width="{p.size[0]}px" style:height="{p.size[1]}px">
    <Widget widget={p.widget} live={false} />
  </span>
{/snippet}

<div class="panel-body" data-tour="add-panel" style:--auto-c={auto.c} style:--auto-ink={auto.ink}>
  <WidgetHeader
    kind="ADD"
    hint={`Drag a widget onto the desk or into a frame. A click adds it where there is room: on the desk, on the tab a selected frame shows, or beside the selected widgets on their tab. A frame always goes on the desk.

On the desk: Shift+click selects more · drag moves, in and out of frames · handles resize · arrows nudge · Del deletes · Esc deselects.`}
    label={onTab ? `to ${widgetName(onTab.frame)} › ${onTab.tab.name}` : 'to the desk'}
  />
  <SkinScope skin={lookStore.forDesk(desk.id).skin}>
    <div class="types">
      {#each WIDGET_TYPES as t (t)}
        <button
          class="tile"
          class:bringing={bringing === t}
          aria-label="Add a {DEFS[t].label}"
          data-tip={t === 'tabs' && onTab
            ? `${DEFS[t].label}: a frame goes on the desk; drag it there, or click to add it`
            : `${DEFS[t].label}: drag onto the desk or into a frame, or click to add`}
          onpointerdown={(e) => down(e, t)}
          onpointermove={move}
          onpointerup={() => (press = null)}
          onpointercancel={() => (press = null)}
          onclick={() => add(t)}
        >
          <!-- A picture of the widget, not a control: out of the tab order and the a11y tree. -->
          <span class="picture" aria-hidden="true" inert>{@render drawing(t)}</span>
        </button>
      {/each}
    </div>
    {#if bringing && drag.pointer}
      <!-- Carried along under the pointer; where it would land shows on the desk. -->
      <div
        class="carried"
        aria-hidden="true"
        inert
        style:transform="translate({drag.pointer.x}px, {drag.pointer.y}px)"
      >
        {@render drawing(bringing)}
      </div>
    {/if}
  </SkinScope>
</div>

<style>
  .panel-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .types {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  /* Room for the largest drawing, its title set into its border and its shadow. */
  .tile {
    height: 124px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid var(--line);
    background: var(--bg);
    cursor: grab;
    /* A drag here is a widget carried out, never the panel scrolling. */
    touch-action: none;
  }
  .tile:hover {
    border-color: var(--fg-dim);
  }
  .tile.bringing {
    border-style: dashed;
  }
  .picture {
    display: flex;
    pointer-events: none;
  }
  /* The tile's own text colour and weight must not leak into the widget. */
  .stage {
    position: relative;
    display: block;
    flex: none;
    color: var(--fg);
    font-weight: 400;
    text-align: left;
  }
  .carried {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 100;
    translate: -50% -50%;
    opacity: 0.8;
    pointer-events: none;
  }
</style>
