<script lang="ts">
  import { LIMITS, type ListWidget } from '../../model/preset';
  import Field from '../../ui/Field.svelte';
  import Icon from '../../ui/Icon.svelte';
  import Segmented from '../../ui/Segmented.svelte';

  let { widget = $bindable(), onchange }: { widget: ListWidget; onchange: () => void } = $props();
  const options = $derived(widget.props.options);

  function move(i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= options.length) return;
    [options[i], options[j]] = [options[j]!, options[i]!];
    onchange();
  }

  function remove(i: number) {
    options.splice(i, 1);
    onchange();
  }

  function add() {
    const n = options.length + 1;
    options.push({ label: `Option ${n}`, value: String(n) });
    onchange();
  }
</script>

<section>
  <Field label="Layout" hint="auto: a strip when wide, a list when tall">
    <Segmented
      options={[
        { value: 'auto', label: 'Auto' },
        { value: 'vertical', label: 'Vertical' },
        { value: 'horizontal', label: 'Horizontal' },
      ]}
      bind:value={widget.props.layout}
      {onchange}
    />
  </Field>
  <div class="options-head">
    <span class="axis-label">Label</span><span class="axis-label">Value</span>
  </div>
  {#each options as o, i (i)}
    <div class="option">
      <input class="input" bind:value={o.label} oninput={onchange} placeholder="label" />
      <input class="input mono" bind:value={o.value} oninput={onchange} placeholder="value" />
      <button class="btn icon ghost" title="Move up" disabled={i === 0} onclick={() => move(i, -1)}
        >▲</button
      >
      <button
        class="btn icon ghost"
        title="Move down"
        disabled={i === options.length - 1}
        onclick={() => move(i, 1)}>▼</button
      >
      <button
        class="btn icon ghost"
        title="Remove option"
        disabled={options.length <= LIMITS.listOptions.min}
        onclick={() => remove(i)}><Icon name="close" /></button
      >
    </div>
  {/each}
  <div class="row">
    <button class="btn ghost" disabled={options.length >= LIMITS.listOptions.max} onclick={add}
      ><Icon name="plus" /> Option</button
    >
    <Field label="Start on">
      <select class="input" bind:value={widget.props.defaultIndex} {onchange}>
        {#each options as o, i (i)}<option value={i}>{o.label || o.value}</option>{/each}
      </select>
    </Field>
  </div>
  <p class="faint">
    Sends {'{'}index, label, value{'}'}; numeric-looking values are sent as numbers.
  </p>
</section>

<style>
  .options-head,
  .option {
    display: grid;
    grid-template-columns: 1fr 1fr auto auto auto;
    gap: 4px;
    align-items: center;
  }
  .options-head {
    grid-template-columns: 1fr 1fr calc(3 * var(--control-h) + 8px);
  }
</style>
