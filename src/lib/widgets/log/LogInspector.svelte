<script lang="ts">
  // INTERACTION for a log: which widgets it follows, how many messages it keeps and what it
  // shows of each.
  import { LIMITS, LOG_COLUMNS, type LogWidget } from '../../model/preset';
  import { presetStore } from '../../state/preset.svelte';
  import Chips from '../../ui/Chips.svelte';
  import Field from '../../ui/Field.svelte';
  import NumberInput from '../../ui/NumberInput.svelte';
  import Segmented from '../../ui/Segmented.svelte';
  import { DEFS, widgetName } from '../defs';
  import { COLUMNS } from './rows';

  let { widget = $bindable(), onchange }: { widget: LogWidget; onchange: () => void } = $props();

  const widgets = $derived(
    presetStore.current.widgets
      .filter((w) => w.id !== widget.id)
      .map((w) => ({ id: w.id, name: widgetName(w), title: DEFS[w.type].label })),
  );
  const columns = LOG_COLUMNS.map((c) => ({ id: c, name: COLUMNS[c].label || 'DIRECTION' }));
</script>

<section>
  <Field label="Follows" wide>
    <Segmented
      options={[
        { value: 'desk', label: 'Every widget', title: 'Every widget of this desk' },
        { value: 'chosen', label: 'Chosen', title: 'The widgets picked below' },
      ]}
      bind:value={widget.props.follow}
      {onchange}
    />
  </Field>
  {#if widget.props.follow === 'chosen'}
    <Chips
      items={widgets}
      picked={widget.props.sources}
      {onchange}
      empty="No other widgets on this desk."
      missingTitle="This widget no longer exists; click to remove"
    />
  {/if}
  <Field label="Keeps" hint="The newest messages, up to {LIMITS.logRows.max}">
    <NumberInput bind:value={widget.props.rows} integer {...LIMITS.logRows} {onchange} />
  </Field>
  <Field
    label="Shows"
    hint="What the widgets sent (→) and received (←) on this device, newest first, and notes about them (•). It isn’t shared with other devices: each shows its own."
    wide
  >
    <Chips
      items={columns}
      picked={widget.props.columns}
      {onchange}
      empty=""
      missingTitle="Not a column; click to remove"
    />
  </Field>
</section>
