<script lang="ts">
  import { LIMITS, type ButtonWidget } from '../../model/preset';
  import Field from '../../ui/Field.svelte';
  import NumberInput from '../../ui/NumberInput.svelte';
  import Segmented from '../../ui/Segmented.svelte';

  let { widget = $bindable(), onchange }: { widget: ButtonWidget; onchange: () => void } = $props();
  const p = $derived(widget.props);
</script>

<section class="grid2">
  <Field
    label="Mode"
    wide
    hint={p.mode === 'momentary'
      ? 'On value while held, off value on release.'
      : 'On value on press only. For on/off state use a Switch.'}
  >
    <Segmented
      options={[
        { value: 'momentary', label: 'Momentary' },
        { value: 'trigger', label: 'Trigger' },
      ]}
      bind:value={widget.props.mode}
      {onchange}
    />
  </Field>
  <Field label="On value"><NumberInput bind:value={widget.props.onValue} {onchange} /></Field>
  <Field label="Off value"><NumberInput bind:value={widget.props.offValue} {onchange} /></Field>
  <Field
    label="Arm then fire"
    wide
    hint={p.arm === 'none'
      ? 'Fires on press.'
      : p.arm === 'double'
        ? 'First press arms it; a second press fires. It disarms after the timeout.'
        : 'Fires only after being held down; letting go early cancels.'}
  >
    <Segmented
      options={[
        { value: 'none', label: 'Off' },
        { value: 'double', label: 'Double-tap' },
        { value: 'hold', label: 'Hold' },
      ]}
      bind:value={widget.props.arm}
      {onchange}
    />
  </Field>
  {#if p.arm === 'double'}
    <Field label="Disarm after ms">
      <NumberInput
        bind:value={widget.props.armTimeoutMs}
        integer
        {...LIMITS.armTimeoutMs}
        {onchange}
      />
    </Field>
  {:else if p.arm === 'hold'}
    <Field label="Hold for ms">
      <NumberInput bind:value={widget.props.holdMs} integer {...LIMITS.holdMs} {onchange} />
    </Field>
  {/if}
</section>
