<script lang="ts">
  // Edit-mode panel when no widget is selected: desk-wide settings and a widget list.
  import { presetStore } from '../lib/state/preset.svelte';
  import { LIMITS } from '../lib/model/preset';
  import { showDesk, showGlobal, ui } from '../lib/state/ui.svelte';
  import { colorVars } from '../lib/theme/palettes';
  import Field from '../lib/ui/Field.svelte';
  import NumberInput from '../lib/ui/NumberInput.svelte';
  import { DEFS, WIDGET_TYPES } from '../lib/widgets/defs';

  const preset = $derived(presetStore.current);
  /** The type column fits the longest type label. */
  const LABEL_WIDTH = Math.max(...WIDGET_TYPES.map((t) => DEFS[t].label.length));
</script>

<div class="panel-body">
  <header>
    <span class="title">DESK</span>
    <span class="faint">{preset.widgets.length} widgets</span>
  </header>
  <p class="faint">Select a widget to edit it, or click one below.</p>

  <h2>Grid</h2>
  <div class="grid3">
    <Field label="Cols">
      <NumberInput
        value={preset.grid.cols}
        integer
        {...LIMITS.gridSide}
        onchange={(cols) => presetStore.setGrid({ cols })}
      />
    </Field>
    <Field label="Rows">
      <NumberInput
        value={preset.grid.rows}
        integer
        {...LIMITS.gridSide}
        onchange={(rows) => presetStore.setGrid({ rows })}
      />
    </Field>
    <Field label="Gap px">
      <NumberInput
        value={preset.grid.gap}
        {...LIMITS.gridGap}
        onchange={(gap) => presetStore.setGrid({ gap })}
      />
    </Field>
  </div>

  <p class="faint">
    Palette, active colour and skin: this desk's own (<button
      class="link"
      onclick={() => showDesk('preset')}>DESK › PRESET</button
    >) or all desks' (<button class="link" onclick={() => showGlobal('look')}
      >GLOBAL SETTINGS › LOOK</button
    >).
  </p>

  <h2>Widgets</h2>
  <ul class="list">
    {#each preset.widgets as w (w.id)}
      <li>
        <button class="row" onclick={() => (ui.selectedId = w.id)}>
          <span class="sw" style:background={colorVars(w.color ?? preset.color).c}></span>
          <span class="type faint">{DEFS[w.type].label.padEnd(LABEL_WIDTH)}</span>
          <span class="name">{w.label}</span>
          <span class="faint">{w.x},{w.y} {w.w}×{w.h}</span>
        </button>
      </li>
    {:else}
      <li class="faint">Empty desk: add a widget from the toolbar.</li>
    {/each}
  </ul>
</div>

<style>
  .panel-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  header {
    display: flex;
    justify-content: space-between;
  }
  .title {
    padding: 0 1ch;
    background: var(--accent);
    color: var(--accent-ink);
    font-weight: 700;
  }
  p {
    margin: 0;
  }
  .grid3 {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1ch;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .row {
    width: 100%;
    display: grid;
    grid-template-columns: 1ch auto 1fr auto;
    gap: 1ch;
    align-items: center;
    padding: 2px 0.5ch;
    border: 0;
    background: none;
    text-align: left;
  }
  .row:hover {
    background: var(--fg);
    color: var(--bg);
  }
  .row:hover .faint {
    color: var(--bg);
  }
  .sw {
    width: 1ch;
    height: 12px;
  }
  .type {
    white-space: pre;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-transform: uppercase;
  }
</style>
