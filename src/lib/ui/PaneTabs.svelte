<script lang="ts" generics="T extends string">
  // Switches a panel between its panes (the desk's ADD / INSPECT): small neutral folder tabs, the
  // third level of navigation under the desk tabs and the F-key sections (docs/ARCHITECTURE.md ›
  // Design rules). The active tab joins the panel below it; the others float just above its
  // line. A pane switch is never a Segmented control: that picks a value.
  interface Props {
    options: readonly { value: T; label: string; tip?: string }[];
    value: T;
    /** What the tabs switch, for screen readers. */
    label: string;
  }
  let { options, value = $bindable(), label }: Props = $props();
</script>

<div class="pane-tabs" role="tablist" aria-label={label}>
  {#each options as o (o.value)}
    <button
      type="button"
      role="tab"
      aria-selected={o.value === value}
      class:on={o.value === value}
      data-tip={o.tip}
      onclick={() => (value = o.value)}>{o.label}</button
    >
  {/each}
</div>

<style>
  /* The line the panes hang from is painted along the bottom; the active tab covers it. */
  .pane-tabs {
    display: flex;
    align-items: flex-end;
    gap: 4px;
    padding: 0 14px;
    box-shadow: inset 0 -1px 0 0 var(--line-strong);
  }
  button {
    height: 24px;
    margin-bottom: 4px;
    padding: 0 1.5ch;
    border: 1px solid var(--line);
    background: var(--bg);
    color: var(--fg-dim);
    text-transform: uppercase;
    white-space: nowrap;
    transition:
      color var(--t-ui) steps(2),
      border-color var(--t-ui) steps(2);
  }
  button:hover {
    color: var(--fg);
    border-color: var(--line-strong);
  }
  button.on {
    height: 28px;
    margin-bottom: 0;
    border-color: var(--line-strong);
    border-bottom-color: transparent;
    background: var(--bg-2);
    color: var(--fg);
    font-weight: 700;
  }
</style>
