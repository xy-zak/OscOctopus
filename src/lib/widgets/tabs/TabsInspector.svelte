<script lang="ts">
  // INTERACTION for a frame: its tabs, in order (renamed, moved, removed; a new one is empty), and
  // the grid they share. What is on a tab is edited where it is, on the desk.
  import { LIMITS, type Tab, type TabsWidget } from '../../model/preset';
  import { presetStore } from '../../state/preset.svelte';
  import Field from '../../ui/Field.svelte';
  import Icon from '../../ui/Icon.svelte';
  import NumberInput from '../../ui/NumberInput.svelte';
  import { removeTab } from './actions';
  import { tabName, tabsFull, TOO_MANY_TABS } from './def';

  let { widget = $bindable(), onchange }: { widget: TabsWidget; onchange: () => void } = $props();

  const full = $derived(tabsFull(widget));
  const grid = $derived(widget.props.grid);

  /** Renames a tab as typed; an empty name keeps the old one. */
  function rename(tab: Tab, text: string) {
    const name = tabName(text);
    if (!name || name === tab.name) return;
    tab.name = name;
    onchange();
  }
</script>

<section class="tabs">
  {#each widget.props.tabs as tab, i (tab.id)}
    <div class="tab">
      <input
        class="input name"
        aria-label="Tab {i + 1} name"
        maxlength={LIMITS.tabName.max}
        value={tab.name}
        onchange={(e) => {
          rename(tab, e.currentTarget.value);
          e.currentTarget.value = tab.name;
        }}
      />
      <button
        class="btn icon"
        data-tip="Earlier"
        disabled={i === 0}
        onclick={() => presetStore.moveTab(widget.id, tab.id, -1)}>‹</button
      >
      <button
        class="btn icon"
        data-tip="Later"
        disabled={i === widget.props.tabs.length - 1}
        onclick={() => presetStore.moveTab(widget.id, tab.id, 1)}>›</button
      >
      <button
        class="btn icon danger"
        data-tip="Remove this tab"
        disabled={widget.props.tabs.length <= 1}
        onclick={() => removeTab(widget.id, tab.id)}><Icon name="trash" /></button
      >
    </div>
  {/each}
  <button
    class="btn add"
    disabled={full}
    data-tip={full ? TOO_MANY_TABS : undefined}
    onclick={() => presetStore.addTab(widget.id)}><Icon name="plus" /> Add a tab</button
  >

  <div class="grid3">
    <Field
      label="Cols"
      hint="One grid for all its tabs. Select the frame, or a widget on it, and ADD puts new widgets on the tab shown; drag widgets in and out, and hold one over a tab’s name to open it. Tabs show only on this device: everyone picks their own."
    >
      <NumberInput
        value={grid.cols}
        integer
        {...LIMITS.gridSide}
        onchange={(cols) => presetStore.setGrid({ cols }, widget.id)}
      />
    </Field>
    <Field label="Rows">
      <NumberInput
        value={grid.rows}
        integer
        {...LIMITS.gridSide}
        onchange={(rows) => presetStore.setGrid({ rows }, widget.id)}
      />
    </Field>
    <Field label="Gap px">
      <NumberInput
        value={grid.gap}
        {...LIMITS.gridGap}
        onchange={(gap) => presetStore.setGrid({ gap }, widget.id)}
      />
    </Field>
  </div>
</section>

<style>
  .tabs {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .tab {
    display: flex;
    gap: 0.5ch;
  }
  .name {
    flex: 1;
    min-width: 0;
  }
  .add {
    align-self: flex-start;
  }
  .grid3 {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1ch;
  }
</style>
