<script lang="ts">
  import { EDITOR_LIMITS, LIMITS, type KnobWidget } from '../../model/preset';
  import Field from '../../ui/Field.svelte';
  import NumberInput from '../../ui/NumberInput.svelte';
  import Segmented from '../../ui/Segmented.svelte';
  import CurveField from '../fields/CurveField.svelte';
  import RateField from '../fields/RateField.svelte';

  let { widget = $bindable(), onchange }: { widget: KnobWidget; onchange: () => void } = $props();
</script>

<section class="grid2">
  <Field
    label="Mode"
    wide
    hint={widget.props.mode === 'bounded'
      ? 'A pot with a range. Drag up/down; double-tap resets.'
      : 'An encoder: each detent sends {value, delta}; delta is ±step.'}
  >
    <Segmented
      options={[
        { value: 'bounded', label: 'Bounded' },
        { value: 'endless', label: 'Endless' },
      ]}
      bind:value={widget.props.mode}
      {onchange}
    />
  </Field>
  {#if widget.props.mode === 'bounded'}
    <Field label="Min"><NumberInput bind:value={widget.props.min} {onchange} /></Field>
    <Field label="Max"><NumberInput bind:value={widget.props.max} {onchange} /></Field>
    <Field label="Step" hint="0 = continuous">
      <NumberInput bind:value={widget.props.step} min={0} {onchange} />
    </Field>
    <Field label="Default" hint="Double-tap resets">
      <NumberInput bind:value={widget.props.defaultValue} {onchange} />
    </Field>
    <Field label="Curve" wide><CurveField bind:value={widget.props.curve} {onchange} /></Field>
  {:else}
    <Field label="Step per detent" hint="the delta">
      <NumberInput bind:value={widget.props.deltaStep} {...EDITOR_LIMITS.deltaStep} {onchange} />
    </Field>
    <Field label="Px per detent" hint="drag sensitivity">
      <NumberInput bind:value={widget.props.detentPx} integer {...LIMITS.detentPx} {onchange} />
    </Field>
    <Field label="Start value" hint="Double-tap resets to it">
      <NumberInput bind:value={widget.props.defaultValue} {onchange} />
    </Field>
  {/if}
  <RateField bind:value={widget.props.maxRateHz} {onchange} />
</section>
