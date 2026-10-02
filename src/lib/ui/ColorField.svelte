<script lang="ts">
  // Any colour: a swatch that opens the system's colour picker, and its hex code to type.
  // `oninput` follows the picker while it is open; `onchange` is a colour settled on (the picker
  // closed, a full code typed, or a short one like #fa0 when the field is left). Without
  // `oninput`, `onchange` follows the picker too.
  import { normalizeHex } from '../theme/generate';

  interface Props {
    /** As #rrggbb. */
    value: string;
    label: string;
    onchange: (hex: string) => void;
    oninput?: (hex: string) => void;
  }
  let { value, label, onchange, oninput }: Props = $props();

  /** What is typed: the value again whenever it changes. */
  let text = $derived(value);
  const ok = $derived(normalizeHex(text) !== null);

  function typed(t: string) {
    text = t;
    if (/^#?[0-9a-f]{6}$/i.test(t.trim())) onchange(normalizeHex(t)!);
  }

  function left() {
    const hex = normalizeHex(text);
    if (hex && hex !== value) onchange(hex);
    text = hex ?? value;
  }
</script>

<span class="color-field">
  <span class="color-well" style:--c={value}>
    <input
      type="color"
      aria-label={label}
      {value}
      oninput={(e) => (oninput ?? onchange)(e.currentTarget.value)}
      onchange={(e) => onchange(e.currentTarget.value)}
    />
  </span>
  <input
    class="input hex"
    class:invalid={!ok}
    aria-label="{label} as hex"
    spellcheck="false"
    value={text}
    oninput={(e) => typed(e.currentTarget.value)}
    onblur={left}
  />
</span>

<style>
  .color-field {
    display: flex;
    gap: 1ch;
  }
  .hex {
    width: 11ch;
    text-transform: lowercase;
  }
</style>
