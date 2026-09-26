<script lang="ts">
  import { LIMITS, type PadsWidget } from '../../model/preset';
  import Field from '../../ui/Field.svelte';
  import NumberInput from '../../ui/NumberInput.svelte';
  import Segmented from '../../ui/Segmented.svelte';

  let { widget = $bindable(), onchange }: { widget: PadsWidget; onchange: () => void } = $props();

  const MODE_HINTS = {
    momentary: 'On while held, off on release.',
    toggle: 'Each hit flips the pad on or off.',
    trigger: 'On only (release sends nothing).',
  } as const;
</script>

<section class="grid2">
  <Field label="Rows">
    <NumberInput bind:value={widget.props.rows} integer {...LIMITS.padsSide} {onchange} />
  </Field>
  <Field label="Columns">
    <NumberInput bind:value={widget.props.cols} integer {...LIMITS.padsSide} {onchange} />
  </Field>
  <Field label="Mode" wide hint={MODE_HINTS[widget.props.mode]}>
    <Segmented
      options={[
        { value: 'momentary', label: 'Momentary' },
        { value: 'toggle', label: 'Toggle' },
        { value: 'trigger', label: 'Trigger' },
      ]}
      bind:value={widget.props.mode}
      {onchange}
    />
  </Field>
  <p class="faint wide-note">
    Numbered 1–{widget.props.rows * widget.props.cols} from the top-left. Each hit sends
    {'{'}number, row, col, on{'}'}.
  </p>
</section>
