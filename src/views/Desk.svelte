<script lang="ts">
  import { isFree, withEditCell } from '../lib/grid/engine';
  import GridCanvas from '../lib/grid/GridCanvas.svelte';
  import { presetStore } from '../lib/state/preset.svelte';
  import { toast, toggleEditMode, ui } from '../lib/state/ui.svelte';
  import { lockedBy, sharedDesks } from '../lib/sync/app.svelte';
  import { syncSession } from '../lib/sync/session.svelte';
  import { colorVars } from '../lib/theme/palettes';
  import Icon from '../lib/ui/Icon.svelte';
  import { DEFS, WIDGET_TYPES } from '../lib/widgets/defs';
  import DeskPanel from './DeskPanel.svelte';
  import Inspector from './Inspector.svelte';
  import WidgetInfo from './widget/WidgetInfo.svelte';

  const editing = $derived(ui.mode === 'edit');
  const preset = $derived(presetStore.current);
  const selectedIndex = $derived(preset.widgets.findIndex((w) => w.id === ui.selectedId));
  const selected = $derived(preset.widgets[selectedIndex]);
  const focused = $derived(presetStore.widget(ui.focusedId));
  // Edit mode always has the panel; live mode has it when the info panel is switched on.
  const panel = $derived(editing || ui.infoOpen);

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
    if (!editing) return;
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, [contenteditable]')) return;
    if (e.key === 'Escape') {
      ui.selectedId = null;
      return;
    }
    if (!selected) return;
    const holder = holderOf(selected.id);
    if (holder) {
      toast(`${holder.name} is editing this widget: take it over in the Inspector first`);
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      presetStore.removeWidget(selected.id);
      e.preventDefault();
      return;
    }
    const d: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const delta = d[e.key];
    if (!delta) return;
    e.preventDefault();
    const next = {
      x: selected.x + delta[0],
      y: selected.y + delta[1],
      w: selected.w,
      h: selected.h,
    };
    if (isFree(next, preset.grid, withEditCell(preset.widgets, preset.grid), selected.id))
      presetStore.setRect(selected.id, next);
  }
</script>

<svelte:window {onkeydown} />

<div class="desk">
  <!-- The tool row is there in both modes, at one fixed height, so the desk below never moves
       when switching: EDIT adds widgets here, LIVE shows or hides the info panel. -->
  <div class="toolbar">
    {#if editing}
      <span class="faint">ADD</span>
      {#each WIDGET_TYPES as t (t)}
        <button class="btn" onclick={() => presetStore.addWidget(t)}
          ><Icon name="plus" /> {DEFS[t].label}</button
        >
      {/each}
      <span class="hint faint"
        >drag: move · handles: resize · arrows: nudge · del: remove · esc: deselect</span
      >
    {:else}
      <!-- A switch like the master bar's (.mbtn), for the side panel. -->
      <button
        class="mbtn switch info"
        role="switch"
        aria-checked={ui.infoOpen}
        title={ui.infoOpen
          ? 'Hide the widget info panel'
          : 'Show the widget info panel (value, messages, activity)'}
        onclick={() => (ui.infoOpen = !ui.infoOpen)}
        ><span class="box">[{ui.infoOpen ? '■' : '\u00a0'}]</span>INFO</button
      >
    {/if}
  </div>
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
        selectedId={ui.selectedId}
        focusedId={ui.infoOpen ? ui.focusedId : null}
        onselect={(id) => (ui.selectedId = id)}
        onfocus={(id) => (ui.focusedId = id)}
        oncommit={(id, rect) => presetStore.setRect(id, rect)}
        locked={ui.locked}
        onlockedpress={() => ui.lockNudge++}
      >
        {#snippet editControl()}
          <!-- Always the top-right cell. A panel toggle switch, so it reads as equipment, not a
               widget: a bat lever through a mounting nut, flipped left for LIVE (green) and right
               for EDIT (grey). In a small cell the words become icons, then give way to the
               lever alone. -->
          <button
            class="mode"
            class:live={!editing}
            role="switch"
            aria-checked={!editing}
            aria-label="Live mode"
            disabled={ui.locked}
            onclick={toggleEditMode}
            title={ui.locked
              ? 'Locked'
              : editing
                ? 'Back to LIVE: play the widgets (Alt+E)'
                : 'Switch to EDIT: move and change widgets (Alt+E)'}
          >
            <span class="labels">
              <span class="lbl live-lbl"
                ><span class="word">LIVE</span><span class="glyph"><Icon name="check" /></span
                ></span
              >
              <span class="lbl edit-lbl"
                ><span class="word">EDIT</span><span class="glyph"><Icon name="pencil" /></span
                ></span
              >
            </span>
            <span class="toggle" aria-hidden="true">
              <span class="nut"></span>
              <span class="lever"><span class="bat"></span></span>
            </span>
          </button>
        {/snippet}
      </GridCanvas>
    </div>
    {#if panel}
      <!-- One persistent panel: its content changes, the panel itself never re-animates. -->
      <aside class="side scroll">
        {#if editing && selected}
          {#key selected.id}
            <Inspector bind:widget={preset.widgets[selectedIndex]!} />
          {/key}
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
  /* One fixed height in both modes (no wrapping: it scrolls sideways when narrow), so switching
     modes swaps its contents without moving anything below. */
  .toolbar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 1ch;
    height: 40px;
    padding: 0 1ch;
    border-bottom: 1px solid var(--line);
    background: var(--bg-2);
    white-space: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .hint,
  .info {
    margin-left: auto;
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
    /* The desk's grid backdrop (dots + crosses) takes the desk's own colour. */
    --grid-tint: var(--scope);
  }
  /* EDIT / LIVE: a panel toggle switch, seen from the front. A bat lever comes out of the
     middle of a mounting nut and points at the mode: left for LIVE (green), right for EDIT
     (grey). Flipping squeezes it through its own length (a scale from -1 to 1), which is how a
     real toggle looks from the front as it snaps over. */
  .mode {
    --tone: var(--line-strong);
    --lever: var(--fg-dim);
    --lever-hi: color-mix(in srgb, var(--lever) 60%, var(--fg));
    --lever-lo: color-mix(in srgb, var(--lever) 55%, var(--bg));
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 2px;
    width: 100%;
    height: 100%;
    padding: 5px 6px;
    border: 1px solid var(--tone);
    background: var(--bg-2);
    box-shadow: 4px 4px 0 0 var(--shadow-px);
    font-weight: 700;
    container-type: size;
    transition: border-color var(--t-ui) steps(2);
  }
  .mode.live {
    --tone: var(--ok);
    --lever: var(--ok);
  }
  .mode:disabled {
    opacity: 0.4;
    cursor: default;
  }
  /* LIVE on the left, EDIT on the right: the side the lever points at is lit. */
  .labels {
    flex: none;
    display: flex;
    justify-content: space-between;
    line-height: 1;
  }
  .lbl {
    display: flex;
    align-items: center;
    color: var(--fg-faint);
    transition: color var(--t-ui) steps(2);
  }
  .live .live-lbl {
    color: var(--ok);
  }
  .mode:not(.live) .edit-lbl {
    color: var(--fg);
  }
  .glyph {
    display: none;
  }
  /* Too narrow for the words: icons. Too short for labels at all: the lever says it. */
  @container (max-width: 9ch) {
    .word {
      display: none;
    }
    .glyph {
      display: inline;
    }
  }
  @container (max-height: 48px) {
    .labels {
      display: none;
    }
  }
  /* Sizes follow the cell: the nut, and the lever's reach from the middle to near the edge. */
  .toggle {
    --nut: clamp(14px, min(46cqh, 34cqw), 34px);
    --reach: calc(50cqw - 14px);
    --bar: clamp(4px, calc(var(--nut) * 0.26), 8px);
    --tip: clamp(8px, calc(var(--nut) * 0.5), 14px);
    position: relative;
    flex: 1;
    min-height: 0;
    /* On the whole switch, not the lever: a mirrored lever would throw its shadow the wrong way. */
    filter: drop-shadow(2px 2px 0 var(--shadow-px));
  }
  /* The mounting nut: an octagon with a rim, around the dark bushing. */
  .nut {
    position: absolute;
    left: 50%;
    top: 50%;
    width: var(--nut);
    height: var(--nut);
    translate: -50% -50%;
    clip-path: polygon(30% 0, 70% 0, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0 70%, 0 30%);
    background:
      radial-gradient(circle, var(--bg) 0 22%, transparent 23%),
      conic-gradient(at 2px 2px, transparent 75%, var(--line) 0) 0 0 / 4px 4px,
      var(--bg-3);
    box-shadow: inset 0 0 0 2px var(--tone);
    transition: box-shadow var(--t-ui) steps(2);
  }
  /* The lever: a bar from the middle out to its bat (the rounded tip), lit on top and shaded
     underneath. Pointing right (EDIT) is scale 1; left (LIVE) is the same lever mirrored. */
  .lever {
    position: absolute;
    left: 50%;
    top: 50%;
    width: var(--reach);
    height: var(--bar);
    translate: 0 -50%;
    transform-origin: 0 50%;
    scale: 1 1;
    background: linear-gradient(
      to bottom,
      var(--lever-hi) 0 1px,
      var(--lever) 1px calc(100% - 1px),
      var(--lever-lo) calc(100% - 1px)
    );
    transition: scale var(--t-release) var(--ease-spring);
  }
  .live .lever {
    scale: -1 1;
  }
  .bat {
    position: absolute;
    right: calc(var(--tip) / -2);
    top: 50%;
    width: var(--tip);
    height: var(--tip);
    translate: 0 -50%;
    clip-path: polygon(30% 0, 70% 0, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0 70%, 0 30%);
    background: linear-gradient(
      to bottom,
      var(--lever-hi) 0 30%,
      var(--lever) 30% 70%,
      var(--lever-lo) 70%
    );
  }
  .mode:active:not(:disabled) .lever {
    transition-duration: var(--t-press);
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
