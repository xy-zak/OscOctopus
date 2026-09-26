<script lang="ts">
  // The send rate limit of a continuous widget (see the throttle gate in osc/sender.ts).
  import { EDITOR_LIMITS } from '../../model/preset';
  import Field from '../../ui/Field.svelte';
  import NumberInput from '../../ui/NumberInput.svelte';

  let { value = $bindable(), onchange }: { value: number; onchange: () => void } = $props();
</script>

<Field
  label="Max rate (msg/s)"
  wide
  hint="0 = send on every pointer event. The final value is always sent."
>
  <NumberInput bind:value {...EDITOR_LIMITS.maxRateHz} {onchange} />
</Field>
