<script lang="ts">
  // [■] / [ ] : the block grows in pixel steps when switched on.
  interface Props {
    checked: boolean;
    label?: string;
    onchange?: (checked: boolean) => void;
  }
  let { checked = $bindable(), label, onchange }: Props = $props();
</script>

<button
  type="button"
  role="switch"
  aria-checked={checked}
  aria-label={label}
  class="toggle"
  class:on={checked}
  onclick={() => {
    checked = !checked;
    onchange?.(checked);
  }}
>
  <span class="br">[</span><span class="box"><span class="dot"></span></span><span class="br"
    >]</span
  >
</button>

<style>
  .toggle {
    flex: none;
    display: inline-flex;
    align-items: center;
    height: var(--control-h);
    padding: 0;
    border: 0;
    background: none;
    color: var(--fg-dim);
  }
  .toggle:hover {
    color: var(--fg);
  }
  .box {
    display: grid;
    place-items: center;
    width: 2ch;
    height: 14px;
  }
  .dot {
    width: 10px;
    height: 10px;
    background: var(--accent);
    scale: 0;
    transition: scale var(--t-release) steps(3, jump-none);
  }
  .on .dot {
    scale: 1;
  }
  .on .br {
    color: var(--accent-text);
  }
</style>
