<script lang="ts">
  import type { SliderWidget } from '../../model/preset';
  import Field from '../../ui/Field.svelte';
  import NumberInput from '../../ui/NumberInput.svelte';
  import Segmented from '../../ui/Segmented.svelte';
  import CurveField from '../fields/CurveField.svelte';
  import RateField from '../fields/RateField.svelte';
  import TouchField from '../fields/TouchField.svelte';

  let { widget = $bindable(), onchange }: { widget: SliderWidget; onchange: () => void } = $props();
</script>

<section class="grid2">
  <Field label="Orientation" wide>
    <Segmented
      options={[
        { value: 'vertical', label: 'Vertical' },
        { value: 'horizontal', label: 'Horizontal' },
      ]}
      bind:value={widget.props.orientation}
      {onchange}
    />
  </Field>
  <Field label="Min"><NumberInput bind:value={widget.props.min} {onchange} /></Field>
  <Field label="Max"><NumberInput bind:value={widget.props.max} {onchange} /></Field>
  <Field label="Step" hint="0 = continuous">
    <NumberInput bind:value={widget.props.step} min={0} {onchange} />
  </Field>
  <Field label="Default" hint="Double-tap resets">
    <NumberInput bind:value={widget.props.defaultValue} {onchange} />
  </Field>
  <Field label="Curve" wide><CurveField bind:value={widget.props.curve} {onchange} /></Field>
  <TouchField bind:value={widget.props.touch} {onchange} />
  <RateField bind:value={widget.props.maxRateHz} {onchange} />
</section>
