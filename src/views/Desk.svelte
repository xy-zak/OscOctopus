<script lang="ts">
  // A desk's CONTROLS: its widgets, and the side panel. In EDIT the panel adds widgets (ADD) or
  // edits what is selected, else the desk (INSPECT; clicking a widget opens it); in LIVE it is
  // the info panel, when INFO is on. The desk's EDIT and INFO switches are on the section bar
  // (DeskSwitches).
  import { untrack } from 'svelte';
  import { DragSession } from '../lib/grid/drag.svelte';
  import GridCanvas from '../lib/grid/GridCanvas.svelte';
  import { canHold, canPlace } from '../lib/model/tabs';
  import { tickHaptic } from '../lib/platform/haptics';
  import { presetStore } from '../lib/state/preset.svelte';
  import { toast, ui } from '../lib/state/ui.svelte';
  import { lockedBy, sharedDesks } from '../lib/sync/app.svelte';
  import { syncSession } from '../lib/sync/session.svelte';
  import { colorVars } from '../lib/theme/palettes';
  import PaneTabs from '../lib/ui/PaneTabs.svelte';
  import { removeWidgets } from '../lib/widgets/tabs/actions';
  import AddPanel from './AddPanel.svelte';
  import DeskPanel from './DeskPanel.svelte';
  import Inspector from './Inspector.svelte';
  import SelectionPanel from './SelectionPanel.svelte';
  import WidgetInfo from './widget/WidgetInfo.svelte';

  const editing = $derived(ui.mode === 'edit');
  const preset = $derived(presetStore.current);
  const selection = $derived(presetStore.selection);
  // One widget selected: it is open in the Inspector.
  const selectedIndex = $derived(
    selection.length === 1 ? preset.widgets.indexOf(selection[0]!) : -1,
  );
  const selected = $derived(preset.widgets[selectedIndex]);
  const focused = $derived(presetStore.widget(ui.focusedId));
  // Edit mode always has the panel; live mode has it when the info panel is switched on, but
  // never while presenting (always live): then the widgets fill the screen.
  const info = $derived(ui.infoOpen && !ui.presenting);
  const panel = $derived(editing || info);

  // Shared desks: who else edits which widget, and what concurrent edits left to sort out.
  const shared = $derived(sharedDesks.view[preset.id]?.shared ?? false);
  function holderOf(id: string) {
    const peer = shared ? lockedBy(preset.id, id)[0] : undefined;
    if (!peer) return null;
    return {
      name: syncSession.peerName(peer),
      color: colorVars(syncSession.peers[peer]?.color ?? 0).c,
    };
  }
  const conflicts = $derived(editing && shared ? sharedDesks.conflicts(preset.id) : []);

  // The desk's one drag (grid/drag.svelte.ts): its widgets moved and resized on its grids, and
  // new ones brought in from ADD. Leaving EDIT (FREEZE too) puts what is dragged back.
  const drag = new DragSession({
    accepts: (l, at) =>
      l.kind === 'add'
        ? canHold(presetStore.current, at, l.type)
        : l.ids.every((id) => canPlace(presetStore.current, id, at)),
    commit: (l, drop) => {
      if (l.kind === 'add') presetStore.addWidget(l.type, { rect: drop.rects[0]!, at: drop.at });
      else presetStore.moveWidgets(drop.rects, drop.at);
    },
    tick: tickHaptic,
  });
  $effect(() => {
    if (!editing) untrack(() => drag.cancel());
  });
  const invalid = $derived(sharedDesks.view[preset.id]?.invalid ?? []);

  function onkeydown(e: KeyboardEvent) {
    // Taken already (Esc putting a carried widget back, a widget's own keys).
    if (!editing || e.defaultPrevented) return;
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, [contenteditable]')) return;
    if (e.key === 'Escape') {
      presetStore.select(null);
      return;
    }
    const [first] = selection;
    if (!first) return;
    const holder = selection.map((w) => holderOf(w.id)).find(Boolean);
    if (holder) {
      const what = selection.length > 1 ? 'one of these widgets' : 'this widget';
      toast(`${holder.name} is editing ${what}: take it over in INSPECT first`);
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      void removeWidgets(ui.selected);
      e.preventDefault();
      return;
    }
    // Nudged in their own grid, the desk's or their frame's, all alike.
    const d: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const delta = d[e.key];
    if (!delta) return;
    e.preventDefault();
    const [dx, dy] = delta;
    const next = selection.map(({ id, x, y, w, h }) => ({ id, x: x + dx, y: y + dy, w, h }));
    presetStore.moveWidgets(next, presetStore.tabOf(first.id));
  }
</script>

<svelte:window {onkeydown} />

<div class="desk">
  {#if conflicts.length || (editing && invalid.length)}
    <div class="conflicts" role="status">
      <span class="tag">CHECK</span>
      <span class="list">
        {#each conflicts.slice(0, 4) as c (c.kind + c.widgetIds.join())}
          <span>{c.text}</span>
        {/each}
        {#if conflicts.length > 4}<span class="faint">and {conflicts.length - 4} more</span>{/if}
        {#each invalid.slice(0, 2) as text (text)}
          <span>received a part that cannot be shown ({text})</span>
        {/each}
      </span>
    </div>
  {/if}
  <div class="body">
    <div class="canvas-wrap">
      <GridCanvas
        {preset}
        {drag}
        {editing}
        {holderOf}
        selected={ui.selected}
        focusedId={info ? ui.focusedId : null}
        onselect={(id, add) => presetStore.select(id, add)}
        onpick={(id, add) => {
          // A widget clicked is to be looked at: INSPECT. Dragging or adding one selects it too,
          // but leaves ADD as it is, so a layout is built without the panel changing under it.
          presetStore.select(id, add);
          ui.editPanel = 'inspect';
        }}
        onfocus={(id) => (ui.focusedId = id)}
        locked={ui.locked}
        onlockedpress={() => ui.lockNudge++}
      />
    </div>
    {#if panel}
      <!-- One persistent panel: its content changes, the panel itself never re-animates. -->
      <aside class="side">
        {#if editing}
          <!-- Stays put while what is below it scrolls. -->
          <div class="switcher">
            <PaneTabs
              label="Side panel"
              options={[
                { value: 'add', label: 'Add', tip: 'Add widgets to the desk or a frame' },
                {
                  value: 'inspect',
                  label: 'Inspect',
                  tip: 'Edit the selected widgets, or the desk when none is selected',
                },
              ]}
              bind:value={ui.editPanel}
            />
          </div>
        {/if}
        <div class="content scroll">
          {#if editing && ui.editPanel === 'add'}
            <AddPanel {drag} />
          {:else if editing && selected}
            {#key selected.id}
              <Inspector bind:widget={preset.widgets[selectedIndex]!} />
            {/key}
          {:else if editing && selection.length > 1}
            <SelectionPanel />
          {:else if editing}
            <DeskPanel />
          {:else}
            <WidgetInfo widget={focused} />
          {/if}
        </div>
      </aside>
    {/if}
  </div>
</div>

<style>
  .desk {
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  /* Concurrent edits that clash (shared desks): shown, never fixed automatically. */
  .conflicts {
    display: flex;
    gap: 1ch;
    padding: 2px 1ch;
    border-bottom: 1px solid var(--warn);
    background: var(--bg-2);
    color: var(--warn);
  }
  .conflicts .tag {
    flex: none;
    padding: 0 1ch;
    background: var(--warn);
    color: var(--bg);
    font-weight: 700;
  }
  .conflicts .list {
    display: flex;
    flex-wrap: wrap;
    gap: 0 2ch;
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .canvas-wrap {
    flex: 1;
    min-width: 0;
    min-height: 0;
    padding: 6px;
    /* The edit-mode grid takes the desk's own colour. */
    --grid-tint: var(--scope);
  }
  .side {
    width: 380px;
    flex: none;
    height: 100%;
    display: flex;
    flex-direction: column;
    /* The same thin rule as under the headers (--line), in both modes. */
    border-left: 1px solid var(--line);
    background: var(--bg-2);
    animation: slide-in var(--t-release) steps(4, end);
  }
  .switcher {
    flex: none;
    padding-top: 10px;
  }
  .content {
    flex: 1;
    min-height: 0;
    padding: 12px 14px 20px;
  }
  @keyframes slide-in {
    from {
      transform: translateX(40px);
      opacity: 0;
    }
  }
  @media (max-width: 760px) {
    .body {
      flex-direction: column;
    }
    .side {
      width: 100%;
      height: 45%;
      border-left: 0;
      border-top: 1px solid var(--line);
    }
  }
</style>
