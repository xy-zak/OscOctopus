<script lang="ts">
  // Relative (drag from the current value) or absolute (jump to the touch point).
  import type { SliderProps } from '../../model/preset';
  import Field from '../../ui/Field.svelte';
  import Segmented from '../../ui/Segmented.svelte';

  let { value = $bindable(), onchange }: { value: SliderProps['touch']; onchange: () => void } =
    $props();
</script>

<Field
  label="Touch"
  wide
  hint={value === 'relative'
    ? 'Drag moves from the current value; nothing jumps on touch.'
    : 'The value jumps to where you touch.'}
>
  <Segmented
    options={[
      { value: 'relative', label: 'Relative' },
      { value: 'absolute', label: 'Absolute' },
    ]}
    bind:value
    {onchange}
  />
</Field>
