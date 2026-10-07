<script lang="ts">
  import { LIMITS, type GraphWidget } from '../../model/preset';
  import Field from '../../ui/Field.svelte';
  import NumberInput from '../../ui/NumberInput.svelte';
  import Toggle from '../../ui/Toggle.svelte';
  import CurveField from '../fields/CurveField.svelte';
  import RateField from '../fields/RateField.svelte';
  import TouchField from '../fields/TouchField.svelte';

  let { widget = $bindable(), onchange }: { widget: GraphWidget; onchange: () => void } = $props();
</script>

<section>
  <!-- One column per axis: each has its own name, range, decimals, default and curve. -->
  <div class="axes">
    <span></span><span class="field-label axis-head">X</span><span class="field-label axis-head"
      >Y</span
    >
    <span class="field-label">Name</span>
    <input class="input" bind:value={widget.props.x.label} oninput={onchange} />
    <input class="input" bind:value={widget.props.y.label} oninput={onchange} />
    <span class="field-label">Min</span>
    <NumberInput bind:value={widget.props.x.min} {onchange} />
    <NumberInput bind:value={widget.props.y.min} {onchange} />
    <span class="field-label">Max</span>
    <NumberInput bind:value={widget.props.x.max} {onchange} />
    <NumberInput bind:value={widget.props.y.max} {onchange} />
    <span class="field-label has-tip" data-tip="0 = whole numbers">Decimals</span>
    <NumberInput bind:value={widget.props.x.decimals} integer {...LIMITS.decimals} {onchange} />
    <NumberInput bind:value={widget.props.y.decimals} integer {...LIMITS.decimals} {onchange} />
    <span class="field-label has-tip" data-tip="Double-tap resets">Default</span>
    <NumberInput bind:value={widget.props.x.defaultValue} {onchange} />
    <NumberInput bind:value={widget.props.y.defaultValue} {onchange} />
    <span class="field-label">Curve</span>
    <CurveField bind:value={widget.props.x.curve} {onchange} />
    <CurveField bind:value={widget.props.y.curve} {onchange} />
  </div>
  <div class="grid2">
    <TouchField bind:value={widget.props.touch} {onchange} />
    <RateField bind:value={widget.props.maxRateHz} {onchange} />
    <Field label="Trail" hint="Fading line of recent points">
      <Toggle bind:checked={widget.props.trail} label="Trail" {onchange} />
    </Field>
  </div>
</section>

<style>
  .axes {
    display: grid;
    grid-template-columns: auto 1fr 1fr;
    gap: 6px 8px;
    align-items: center;
  }
  .axis-head {
    text-align: center;
  }
</style>
