<script lang="ts" generics="T extends string">
  // [ OPT A │ OPT B ] with a reverse-video block that slides to the selection.
  interface Props {
    options: readonly { value: T; label: string; title?: string }[];
    value: T;
    onchange?: (value: T) => void;
    size?: 'sm' | 'md';
  }
  let { options, value = $bindable(), onchange, size = 'md' }: Props = $props();

  const index = $derived(
    Math.max(
      0,
      options.findIndex((o) => o.value === value),
    ),
  );
</script>

<div class="seg {size}" role="radiogroup" style:--n={options.length} style:--i={index}>
  <span class="thumb" aria-hidden="true"></span>
  {#each options as o (o.value)}
    <button
      type="button"
      role="radio"
      aria-checked={o.value === value}
      data-tip={o.title}
      class:on={o.value === value}
      onclick={() => {
        if (o.value === value) return;
        value = o.value;
        onchange?.(o.value);
      }}>{o.label}</button
    >
  {/each}
</div>

<style>
  .seg {
    position: relative;
    display: grid;
    grid-template-columns: repeat(var(--n), 1fr);
    border: 1px solid var(--line);
    background: var(--bg);
    min-width: 0;
  }
  .thumb {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: calc(100% / var(--n));
    background: var(--fg);
    transform: translateX(calc(var(--i) * 100%));
    transition: transform var(--t-release) var(--ease-spring);
  }
  /* Disabled (a FROZEN Lockable): the block dims with the buttons (app.css). */
  .seg:has(button:disabled) .thumb {
    opacity: 0.4;
  }
  button {
    position: relative;
    height: calc(var(--control-h) - 2px);
    padding: 0 1ch;
    border: 0;
    background: none;
    color: var(--fg-dim);
    text-transform: uppercase;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: color var(--t-ui) steps(2);
  }
  button + button {
    border-left: 1px solid var(--line);
  }
  .sm button {
    height: 22px;
    padding: 0 0.5ch;
  }
  button.on {
    color: var(--bg);
    font-weight: 700;
  }
  button:not(.on):hover {
    color: var(--fg);
  }
</style>
