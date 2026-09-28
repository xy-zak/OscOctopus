<script lang="ts">
  // A fixed OSC argument: its type and, for the types that carry one, its value (kept as text
  // and converted when sent, osc/mapping.ts). Used by messages and by sequencer steps.
  import type { ConstArg, ConstArgType } from '../../model/preset';

  // `arg` is edited in place (it belongs to the preset store).
  let { arg, onchange }: { arg: ConstArg; onchange: () => void } = $props();

  const TYPES: { value: ConstArgType; label: string }[] = [
    { value: 'f', label: 'f float32' },
    { value: 'i', label: 'i int32' },
    { value: 'd', label: 'd float64' },
    { value: 'h', label: 'h int64' },
    { value: 's', label: 's string' },
    { value: 'T', label: 'T true' },
    { value: 'F', label: 'F false' },
    { value: 'N', label: 'N nil' },
    { value: 'I', label: 'I impulse' },
  ];
  /** Types that carry no value. */
  const VALUELESS: readonly ConstArgType[] = ['T', 'F', 'N', 'I'];
</script>

<select class="input" title="Argument type" bind:value={arg.type} {onchange}>
  {#each TYPES as t (t.value)}<option value={t.value}>{t.label}</option>{/each}
</select>
{#if !VALUELESS.includes(arg.type)}
  <input class="input mono" title="Argument value" bind:value={arg.value} oninput={onchange} />
{/if}
