<script lang="ts">
  import { isFree, withEditCell } from '../lib/grid/engine';
  import GridCanvas from '../lib/grid/GridCanvas.svelte';
  import { presetStore } from '../lib/state/preset.svelte';
  import { toggleEditMode, ui } from '../lib/state/ui.svelte';
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

  function onkeydown(e: KeyboardEvent) {
    if (!editing) return;
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, [contenteditable]')) return;
    if (e.key === 'Escape') {
      ui.selectedId = null;
      return;
    }
    if (!selected) return;
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
  {#if editing}
    <div class="toolbar">
      <span class="faint">ADD</span>
      {#each WIDGET_TYPES as t (t)}
        <button class="btn" onclick={() => presetStore.addWidget(t)}
          ><Icon name="plus" /> {DEFS[t].label}</button
        >
      {/each}
      <span class="hint faint"
        >drag: move · handles: resize · arrows: nudge · del: remove · esc: deselect</span
      >
    </div>
  {/if}
  <div class="body">
    <div class="canvas-wrap">
      <GridCanvas
        {preset}
        {editing}
        selectedId={ui.selectedId}
        focusedId={ui.infoOpen ? ui.focusedId : null}
        onselect={(id) => (ui.selectedId = id)}
        onfocus={(id) => (ui.focusedId = id)}
        oncommit={(id, rect) => presetStore.setRect(id, rect)}
        locked={ui.locked}
        onlockedpress={() => ui.lockNudge++}
      >
        {#snippet editControl()}
          <!-- Always the two top-right cells. A key switch on a screwed-on plate, so it reads as
               equipment, not a widget: the key points at EDIT (grey) or LIVE (green, lamp lit).
               The labels become icons when the words don't fit. -->
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
            <span class="lbl edit-lbl"
              ><span class="word">EDIT</span><span class="glyph"><Icon name="pencil" /></span></span
            >
            <span class="lock" aria-hidden="true">
              <span class="tick to-edit"></span>
              <span class="tick to-live"></span>
              <span class="key"></span>
            </span>
            <span class="lbl live-lbl"
              ><span class="word">LIVE</span><span class="glyph"><Icon name="check" /></span><span
                class="lamp"
              ></span></span
            >
          </button>
        {/snippet}
      </GridCanvas>
    </div>
    {#if panel}
      <!-- One persistent panel: its content changes, the panel itself never re-animates. -->
      <aside class="side scroll" class:edit={editing}>
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
  .toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 1ch;
    padding: 6px 1ch;
    border-bottom: 1px solid var(--line);
    background: var(--bg-2);
    animation: drop var(--t-release) steps(3, end);
  }
  @keyframes drop {
    from {
      transform: translateY(-100%);
      opacity: 0;
    }
  }
  .hint {
    margin-left: auto;
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
  /* EDIT / LIVE: a key switch on a plate held by four screws. Grey for EDIT, green for LIVE.
     --dia: the lock cylinder, as big as the plate's height allows. */
  .mode {
    --tone: var(--line-strong);
    --key: var(--fg-dim);
    --screw: radial-gradient(circle, var(--line-strong) 1.5px, transparent 2px);
    --dia: min(calc(100cqh - 14px), 32cqw);
    display: flex;
    align-items: center;
    width: 100%;
    height: 100%;
    padding: 0 6px;
    border: 1px solid var(--tone);
    background:
      var(--screw) 0 0 / 10px 10px no-repeat,
      var(--screw) 100% 0 / 10px 10px no-repeat,
      var(--screw) 0 100% / 10px 10px no-repeat,
      var(--screw) 100% 100% / 10px 10px no-repeat,
      var(--bg-2);
    box-shadow: 4px 4px 0 0 var(--shadow-px);
    font-weight: 700;
    container-type: size;
    transition: border-color var(--t-ui) steps(2);
  }
  .mode.live {
    --tone: var(--ok);
    --key: var(--ok);
  }
  .mode:disabled {
    opacity: 0.4;
    cursor: default;
  }
  /* The label of the mode the key points at is lit; the other stays faint. */
  .lbl {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75ch;
    color: var(--fg-faint);
    transition: color var(--t-ui) steps(2);
  }
  .mode:not(.live) .edit-lbl {
    color: var(--fg);
  }
  .live .live-lbl {
    color: var(--ok);
  }
  .glyph {
    display: none;
  }
  /* Too narrow for the words beside the lock: icons instead. */
  @container (max-width: 17ch) {
    .word {
      display: none;
    }
    .glyph {
      display: inline;
    }
  }
  /* The lamp: dark in EDIT, green and lit in LIVE. */
  .lamp {
    flex: none;
    width: 6px;
    height: 6px;
    background: var(--line);
    transition:
      background var(--t-ui) steps(2),
      box-shadow var(--t-ui) steps(2);
  }
  .live .lamp {
    background: var(--ok);
    box-shadow: 0 0 6px 1px color-mix(in srgb, var(--ok) 60%, transparent);
  }
  /* The lock cylinder: a round, dithered barrel with a tick at each position. */
  .lock {
    position: relative;
    flex: none;
    width: var(--dia);
    height: var(--dia);
    border: 2px solid var(--tone);
    border-radius: 50%;
    background:
      conic-gradient(at 2px 2px, transparent 75%, var(--line) 0) 0 0 / 4px 4px,
      var(--bg);
    transition: border-color var(--t-ui) steps(2);
  }
  /* Ticks sit just outside the barrel, 45° either side of straight up. */
  .tick {
    position: absolute;
    left: 50%;
    bottom: 50%;
    width: 1px;
    height: calc(var(--dia) / 2 + 5px);
    background: linear-gradient(to top, transparent calc(100% - 4px), var(--fg-faint) 0);
    transform-origin: 50% 100%;
  }
  .tick.to-edit {
    rotate: -45deg;
  }
  .tick.to-live {
    rotate: 45deg;
  }
  /* The key's bow, seen end-on: a bar across the barrel whose top end (the notch) points at
     the mode. It turns with a spring, like a key clicking into place. */
  .key {
    position: absolute;
    left: 50%;
    top: 50%;
    width: max(5px, calc(var(--dia) * 0.26));
    height: calc(var(--dia) * 0.9);
    translate: -50% -50%;
    rotate: -45deg;
    background: var(--key);
    box-shadow: 2px 2px 0 0 var(--shadow-px);
    transition:
      rotate var(--t-release) var(--ease-spring),
      background var(--t-ui) steps(2);
  }
  .key::before {
    content: '';
    position: absolute;
    left: 50%;
    top: 2px;
    width: 2px;
    height: 3px;
    translate: -50% 0;
    background: var(--bg);
  }
  .live .key {
    rotate: 45deg;
  }
  .mode:active:not(:disabled) .key {
    transition-duration: var(--t-press);
  }
  .side {
    width: 380px;
    flex: none;
    height: 100%;
    padding: 12px 14px 20px;
    border-left: 1px solid var(--line);
    background: var(--bg-2);
    animation: slide-in var(--t-release) steps(4, end);
  }
  .side.edit {
    border-left-color: var(--accent);
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
    .side.edit {
      border-top-color: var(--accent);
    }
  }
</style>
