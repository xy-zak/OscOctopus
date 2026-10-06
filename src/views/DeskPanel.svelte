<script lang="ts">
  // Edit-mode panel when no widget is selected: the desk's grid, and its widgets, each frame with
  // its tabs and what is on them.
  import { LIMITS, type Widget } from '../lib/model/preset';
  import { childrenIndex, colorOf, isTabs, tabKey } from '../lib/model/tabs';
  import { presetStore } from '../lib/state/preset.svelte';
  import { showDesk, showGlobal, ui } from '../lib/state/ui.svelte';
  import { colorVars } from '../lib/theme/palettes';
  import Field from '../lib/ui/Field.svelte';
  import NumberInput from '../lib/ui/NumberInput.svelte';
  import { plural } from '../lib/util';
  import { DEFS, WIDGET_TYPES } from '../lib/widgets/defs';

  const preset = $derived(presetStore.current);
  const index = $derived(childrenIndex(preset));
  /** The type column fits the longest type label. */
  const LABEL_WIDTH = Math.max(...WIDGET_TYPES.map((t) => DEFS[t].label.length));
</script>

{#snippet row(w: Widget, level: number)}
  <li>
    <!-- Selected, it shows on its tab (widgets/tabs/Tabs.svelte). -->
    <button class="row" style:--level={level} onclick={() => (ui.selectedId = w.id)}>
      <span class="sw" style:background={colorVars(colorOf(preset, w)).c}></span>
      <span class="type faint">{DEFS[w.type].label.padEnd(LABEL_WIDTH)}</span>
      <span class="name">{w.label}</span>
      <span class="faint">{w.x},{w.y} {w.w}×{w.h}</span>
    </button>
  </li>
{/snippet}

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
      onclick={() => showDesk('look')}>DESK › LOOK</button
    >) or all desks' (<button class="link" onclick={() => showGlobal('look')}
      >GLOBAL SETTINGS › LOOK</button
    >).
  </p>

  <h2>Widgets</h2>
  <ul class="list">
    {#each index.get('') ?? [] as w (w.id)}
      {@render row(w, 0)}
      {#if isTabs(w)}
        {#each w.props.tabs as tab (tab.id)}
          {@const on = index.get(tabKey({ widget: w.id, tab: tab.id })) ?? []}
          <li>
            <button
              class="row tab"
              style:--level={1}
              title="Show this tab"
              onclick={() => {
                presetStore.showTab(w.id, tab.id);
                ui.selectedId = w.id;
              }}
              ><span class="faint">›</span><span class="name">{tab.name}</span><span class="faint"
                >{plural(on.length, 'widget')}</span
              ></button
            >
          </li>
          {#each on as c (c.id)}
            {@render row(c, 2)}
          {/each}
        {/each}
      {/if}
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
    padding: 2px 0.5ch 2px calc(0.5ch + var(--level, 0) * 2ch);
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
  /* A frame's tab, between the frame and what is on it. */
  .row.tab {
    grid-template-columns: 1ch 1fr auto;
    color: var(--fg-dim);
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
