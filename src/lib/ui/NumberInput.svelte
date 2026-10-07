<script lang="ts">
  // Keeps the typed text locally and only commits values that are valid, so a half-typed
  // number never reaches the network config. Invalid input is flagged, not swallowed.
  // `onchange` may return false to reject a valid number (e.g. a grid size that would clip
  // widgets); the field then reverts.
  interface Props {
    value: number;
    min?: number;
    max?: number;
    integer?: boolean;
    placeholder?: string;
    tip?: string;
    onchange?: (value: number) => void | boolean;
  }
  let {
    value = $bindable(),
    min = -Infinity,
    max = Infinity,
    integer = false,
    placeholder,
    tip,
    onchange,
  }: Props = $props();

  let text = $state('');
  let focused = $state(false);
  $effect(() => {
    if (!focused) text = String(value);
  });

  const parsed = $derived(Number(text.trim()));
  const valid = $derived(
    text.trim() !== '' &&
      Number.isFinite(parsed) &&
      parsed >= min &&
      parsed <= max &&
      (!integer || Number.isInteger(parsed)),
  );

  function commit() {
    if (valid && parsed !== value) {
      if (onchange?.(parsed) === false) {
        text = String(value);
        return;
      }
      value = parsed;
    }
    if (!valid) text = String(value);
  }
</script>

<input
  class="input mono"
  class:invalid={!valid}
  inputmode={integer && min >= 0 ? 'numeric' : 'decimal'}
  {placeholder}
  data-tip={valid
    ? tip
    : `Must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}`}
  bind:value={text}
  onfocus={() => (focused = true)}
  onblur={() => {
    focused = false;
    commit();
  }}
  onkeydown={(e) => {
    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
    if (e.key === 'Escape') {
      text = String(value);
      (e.currentTarget as HTMLInputElement).blur();
    }
  }}
/>
