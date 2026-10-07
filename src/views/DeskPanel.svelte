<script lang="ts">
  // Edit-mode panel when no widget is selected: the desk's grid, and its widgets, each frame with
  // its tabs and what is on them.
  import { LIMITS } from '../lib/model/preset';
  import { childrenIndex, isTabs, tabKey } from '../lib/model/tabs';
  import { presetStore } from '../lib/state/preset.svelte';
  import { persistSetting } from '../lib/state/persist';
  import { showDesk, showGlobal, ui, type InspectorSection } from '../lib/state/ui.svelte';
  import Collapsible from '../lib/ui/Collapsible.svelte';
  import Field from '../lib/ui/Field.svelte';
  import NumberInput from '../lib/ui/NumberInput.svelte';
  import { plural } from '../lib/util';
  import WidgetHeader from './widget/WidgetHeader.svelte';
  import WidgetRow from './WidgetRow.svelte';

  const preset = $derived(presetStore.current);
  const index = $derived(childrenIndex(preset));

  // Folded and unfolded like the Inspector's sections, and remembered with them.
  const toggle = (s: InspectorSection) => (on: boolean) => {
    ui.inspectorOpen[s] = on;
    void persistSetting('inspectorSections', { ...ui.inspectorOpen });
  };
</script>

<div class="panel-body">
  <WidgetHeader
    kind="DESK"
    hint="Select a widget to edit it, or click one below; Shift+click selects several."
    label={preset.name}
  />

  <Collapsible
    title="Grid"
    open={ui.inspectorOpen.grid}
    ontoggle={toggle('grid')}
    summary="{preset.grid.cols}×{preset.grid.rows} · gap {preset.grid.gap}px"
  >
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
  </Collapsible>

  <Collapsible
    title="Widgets"
    open={ui.inspectorOpen.widgets}
    ontoggle={toggle('widgets')}
    summary={plural(preset.widgets.length, 'widget')}
  >
    <ul class="list">
      {#each index.get('') ?? [] as w (w.id)}
        <WidgetRow widget={w} />
        {#if isTabs(w)}
          {#each w.props.tabs as tab (tab.id)}
            {@const on = index.get(tabKey({ widget: w.id, tab: tab.id })) ?? []}
            <li>
              <button
                class="tab"
                data-tip="Show this tab"
                onclick={() => {
                  presetStore.showTab(w.id, tab.id);
                  presetStore.select(w.id);
                }}
                ><span class="faint">›</span><span class="name entity-name">{tab.name}</span><span
                  class="faint">{plural(on.length, 'widget')}</span
                ></button
              >
            </li>
            {#each on as c (c.id)}
              <WidgetRow widget={c} level={2} />
            {/each}
          {/each}
        {/if}
      {:else}
        <li class="faint">Empty desk: add a widget from ADD, above.</li>
      {/each}
    </ul>
  </Collapsible>
</div>

<style>
  .panel-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
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
  /* A frame's tab, between the frame and what is on it (a WidgetRow's look, one level in). */
  .tab {
    width: 100%;
    display: grid;
    grid-template-columns: 1ch 1fr auto;
    gap: 1ch;
    align-items: center;
    padding: 2px 0.5ch 2px 2.5ch;
    border: 0;
    background: none;
    color: var(--fg-dim);
    text-align: left;
  }
  .tab:hover {
    background: var(--fg);
    color: var(--bg);
  }
  .tab:hover .faint {
    color: var(--bg);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
