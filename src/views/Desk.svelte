<script lang="ts">
  import GridCanvas from '../lib/grid/GridCanvas.svelte';
  import { tabAt } from '../lib/model/tabs';
  import { presetStore } from '../lib/state/preset.svelte';
  import { toast, toggleEditMode, ui } from '../lib/state/ui.svelte';
  import { lockedBy, sharedDesks } from '../lib/sync/app.svelte';
  import { syncSession } from '../lib/sync/session.svelte';
  import { colorVars } from '../lib/theme/palettes';
  import Icon from '../lib/ui/Icon.svelte';
  import ToggleSwitch from '../lib/ui/ToggleSwitch.svelte';
  import { DEFS, WIDGET_TYPES, widgetName } from '../lib/widgets/defs';
  import { removeWidgets } from '../lib/widgets/tabs/actions';
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
  // EDIT: the frame tab ADD puts new widgets on (null: the desk), named as the toolbar shows it.
  const adding = $derived.by(() => {
    const at = presetStore.addingTo;
    const found = at && tabAt(preset, at);
    return found ? `${widgetName(found.frame)} › ${found.tab.name}`.toUpperCase() : null;
  });
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
      toast(`${holder.name} is editing ${what}: take it over in the Inspector first`);
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
  <!-- The tool row is there in both modes, at one fixed height, so the desk below never moves
       when switching: EDIT adds widgets here, LIVE shows or hides the info panel. Presenting
       hides it. -->
  {#if !ui.presenting}
    <div class="toolbar">
      <div class="tools">
        {#if editing}
          <span class="faint"
            >ADD{#if adding}&nbsp;→ {adding}{/if}</span
          >
          {#each WIDGET_TYPES as t (t)}
            <button
              class="btn"
              title={t === 'tabs' && adding ? 'A frame goes on the desk' : undefined}
              onclick={() => presetStore.addWidget(t)}><Icon name="plus" /> {DEFS[t].label}</button
            >
          {/each}
          <span class="hint faint"
            >shift+click: select more · drag: move, in and out of frames · handles: resize · arrows:
            nudge · del: remove · esc: deselect</span
          >
        {:else}
          <!-- A switch like the master bar's, for the side panel. -->
          <span class="info">
            <ToggleSwitch
              label="INFO"
              on={ui.infoOpen}
              onclick={() => (ui.infoOpen = !ui.infoOpen)}
              title={ui.infoOpen
                ? 'Hide the widget info panel'
                : 'Show the widget info panel (value, messages, activity)'}
            />
          </span>
        {/if}
      </div>
      <!-- Live ⇄ edit, the same kind of switch. Outside the scrolling tools and last in the row,
         so it stays in one place in both modes and never scrolls out of reach. -->
      <ToggleSwitch
        label="EDIT"
        on={editing}
        disabled={ui.locked}
        onclick={toggleEditMode}
        title={ui.locked
          ? 'Locked'
          : editing
            ? 'Back to LIVE: play the widgets (Alt+E)'
            : 'Switch to EDIT: move and change widgets (Alt+E)'}
      />
    </div>
  {/if}
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
        {editing}
        {holderOf}
        selected={ui.selected}
        focusedId={info ? ui.focusedId : null}
        onselect={(id, add) => presetStore.select(id, add)}
        onfocus={(id) => (ui.focusedId = id)}
        oncommit={(rects, parent) => presetStore.moveWidgets(rects, parent)}
        locked={ui.locked}
        onlockedpress={() => ui.lockNudge++}
      />
    </div>
    {#if panel}
      <!-- One persistent panel: its content changes, the panel itself never re-animates. -->
      <aside class="side scroll">
        {#if editing && selected}
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
  /* One fixed height in both modes (no wrapping: the tools scroll sideways when narrow), so
     switching modes swaps its contents without moving anything below. */
  .toolbar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 1ch;
    height: 40px;
    padding: 0 1ch;
    border-bottom: 1px solid var(--line);
    background: var(--bg-2);
  }
  .tools {
    flex: 1;
    min-width: 0;
    height: 100%;
    display: flex;
    align-items: center;
    gap: 1ch;
    white-space: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .hint,
  .info {
    margin-left: auto;
  }
  .info {
    display: flex;
  }
  .toolbar > :global(.mbtn) {
    flex: none;
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
    padding: 12px 14px 20px;
    /* The same thin rule as under the headers (--line), in both modes. */
    border-left: 1px solid var(--line);
    background: var(--bg-2);
    animation: slide-in var(--t-release) steps(4, end);
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
    .hint {
      display: none;
    }
    .side {
      width: 100%;
      height: 45%;
      border-left: 0;
      border-top: 1px solid var(--line);
    }
  }
</style>
