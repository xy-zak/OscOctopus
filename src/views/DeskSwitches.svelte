<script lang="ts">
  // The desk's own switches, at the right end of the section bar while its CONTROLS are open, in
  // the master bar's shape: INFO (LIVE: the side panel with what the widget touched last does)
  // and EDIT (LIVE ⇄ EDIT, Alt+E). EDIT is last, so it stays in one place in both modes.
  import { toggleEditMode, ui } from '../lib/state/ui.svelte';
  import ToggleSwitch from '../lib/ui/ToggleSwitch.svelte';

  const editing = $derived(ui.mode === 'edit');
</script>

<div class="switches">
  {#if !editing}
    <ToggleSwitch
      label="INFO"
      on={ui.infoOpen}
      onclick={() => (ui.infoOpen = !ui.infoOpen)}
      title={ui.infoOpen
        ? 'Hide the widget info panel'
        : 'Show the widget info panel (value, messages, activity)'}
    />
  {/if}
  <ToggleSwitch
    label="EDIT"
    on={editing}
    disabled={ui.locked}
    onclick={toggleEditMode}
    title={ui.locked
      ? 'Frozen'
      : editing
        ? 'Back to LIVE: play the widgets (Alt+E)'
        : 'Switch to EDIT: add, move and change widgets (Alt+E)'}
  />
</div>

<style>
  .switches {
    flex: none;
    display: flex;
    gap: 1ch;
  }
</style>
