<script lang="ts">
  import type { SwitchWidget } from '../../model/preset';
  import Field from '../../ui/Field.svelte';
  import NumberInput from '../../ui/NumberInput.svelte';

  let { widget = $bindable(), onchange }: { widget: SwitchWidget; onchange: () => void } = $props();
</script>

<section class="grid2">
  <Field
    label="On value"
    hint="Tap flips it; dragging the knob sets the side you release on. Sends once per change."
    ><NumberInput bind:value={widget.props.onValue} {onchange} /></Field
  >
  <Field label="Off value"><NumberInput bind:value={widget.props.offValue} {onchange} /></Field>
</section>
