<script lang="ts">
  // Edit-mode panel when no widget is selected: the grid of what is open (the desk, or a sub-desk
  // page) and its widgets, sub-desks with their pages and what is on them.
  import { LIMITS } from '../lib/model/preset';
  import {
    childrenIndex,
    colorOf,
    gridOn,
    pageAt,
    pageKey,
    widgetsUnder,
    type PageRef,
  } from '../lib/model/subdesks';
  import { presetStore } from '../lib/state/preset.svelte';
  import { showDesk, showGlobal } from '../lib/state/ui.svelte';
  import { colorVars } from '../lib/theme/palettes';
  import Field from '../lib/ui/Field.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import NumberInput from '../lib/ui/NumberInput.svelte';
  import { DEFS, WIDGET_TYPES, widgetName } from '../lib/widgets/defs';

  const preset = $derived(presetStore.current);
  const page = $derived(presetStore.page);
  const open = $derived(page ? pageAt(preset, page) : undefined);
  const grid = $derived(gridOn(preset, page));
  const index = $derived(childrenIndex(preset));
  const count = $derived(page ? widgetsUnder(preset, page).length : preset.widgets.length);
  /** The type column fits the longest type label. */
  const LABEL_WIDTH = Math.max(...WIDGET_TYPES.map((t) => DEFS[t].label.length));
</script>

{#snippet rows(at: PageRef | null, level: number)}
  {#each index.get(pageKey(at)) ?? [] as w (w.id)}
    <li>
      <button class="row" style:--level={level} onclick={() => presetStore.reveal(w.id)}>
        <span class="sw" style:background={colorVars(colorOf(preset, w)).c}></span>
        <span class="type faint">{DEFS[w.type].label.padEnd(LABEL_WIDTH)}</span>
        <span class="name">{w.label}</span>
        <span class="faint">{w.x},{w.y} {w.w}×{w.h}</span>
      </button>
    </li>
    {#if w.type === 'subdesk'}
      {#each w.props.pages as pg (pg.id)}
        {@const ref = { widget: w.id, page: pg.id }}
        <li>
          <button
            class="row page"
            style:--level={level + 1}
            title="Open this page"
            onclick={() => presetStore.openPage(ref)}
            ><Icon name="open" /><span class="name">{pg.name}</span><span class="faint"
              >{pg.grid.cols}×{pg.grid.rows}</span
            ></button
          >
        </li>
        {@render rows(ref, level + 2)}
      {/each}
    {/if}
  {/each}
{/snippet}

<div class="panel-body">
  <header>
    <span class="title">{open ? 'PAGE' : 'DESK'}</span>
    <span class="faint">{count} widgets</span>
  </header>
  {#if open}
    <p class="faint">
      “{open.page.name}” of “{widgetName(open.subdesk)}”: a grid of its own. Select a widget to edit
      it, or click one below.
    </p>
  {:else}
    <p class="faint">Select a widget to edit it, or click one below.</p>
  {/if}

  <h2>{open ? 'Page grid' : 'Grid'}</h2>
  <div class="grid3">
    <Field label="Cols">
      <NumberInput
        value={grid.cols}
        integer
        {...LIMITS.gridSide}
        onchange={(cols) => presetStore.setGrid({ cols })}
      />
    </Field>
    <Field label="Rows">
      <NumberInput
        value={grid.rows}
        integer
        {...LIMITS.gridSide}
        onchange={(rows) => presetStore.setGrid({ rows })}
      />
    </Field>
    <Field label="Gap px">
      <NumberInput
        value={grid.gap}
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
    {@render rows(page, 0)}
    {#if count === 0}
      <li class="faint">Empty {open ? 'page' : 'desk'}: add a widget from the toolbar.</li>
    {/if}
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
  /* A sub-desk's page, between the sub-desk and what is on it. */
  .row.page {
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
