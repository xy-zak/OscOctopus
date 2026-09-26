<script lang="ts">
  // Lin / Exp / Log: how a position maps onto a range (see osc/curves.ts).
  import type { Axis } from '../../model/preset';
  import Segmented from '../../ui/Segmented.svelte';

  let { value = $bindable(), onchange }: { value: Axis['curve']; onchange: () => void } = $props();
</script>

<Segmented
  size="sm"
  options={[
    { value: 'linear', label: 'Lin' },
    { value: 'exp', label: 'Exp', title: 'Finer control near min' },
    { value: 'log', label: 'Log', title: 'Finer control near max' },
  ]}
  bind:value
  {onchange}
/>
