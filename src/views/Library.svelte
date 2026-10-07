<script lang="ts">
  // GLOBAL SETTINGS › LIBRARY: every saved desk preset on this device, open or not. Open one as a
  // desk, jump to an open one, delete, create a blank desk, or import a file as a new desk.
  import { presetStore } from '../lib/state/preset.svelte';
  import { showDesk, toast } from '../lib/state/ui.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import Lockable from '../lib/ui/Lockable.svelte';
  import Panel from '../lib/ui/Panel.svelte';
  import { addDesk, deletePreset, importAsDesk, openDesk } from './deskActions';

  let newName = $state('');

  const goToDesk = (id: string) => {
    presetStore.activate(id);
    showDesk('controls');
  };

  async function openAsDesk(id: string, name: string) {
    if (await openDesk(id, name)) toast(`Opened "${name}" as a desk`);
  }

  async function newDesk() {
    if (!(await addDesk(newName.trim()))) return;
    newName = '';
    goToDesk(presetStore.current.id);
  }
</script>

<div class="page scroll">
  <Lockable>
    <Panel
      title="Saved desk presets · this device"
      hint="■ = open as a desk. Stored in {presetStore.dir}"
    >
      {#snippet actions()}<span class="faint">{presetStore.summaries.length} saved</span>{/snippet}
      <ul>
        {#each presetStore.summaries as s (s.fileName)}
          {@const open = presetStore.isOpen(s.id)}
          <li class:open class:broken={s.error}>
            <span class="mark">{open ? '■' : '·'}</span>
            <div class="info">
              <span class="name entity-name">{s.name}</span>
              <span class="faint"
                >{s.fileName}{s.updatedAt
                  ? ` · ${new Date(s.updatedAt).toLocaleString()}`
                  : ''}</span
              >
              {#if s.error}<span class="error-text">{s.error}</span>{/if}
            </div>
            <div class="row">
              {#if open}
                <button class="btn" onclick={() => goToDesk(s.id)}>Go to desk</button>
              {:else if !s.error}
                <button class="btn" onclick={() => openAsDesk(s.id, s.name)}>Open as desk</button>
              {/if}
              <button
                class="btn icon ghost danger"
                data-tip="Delete preset"
                onclick={() => deletePreset(s.id, s.name)}><Icon name="trash" /></button
              >
            </div>
          </li>
        {/each}
      </ul>
      <div class="row">
        <input class="input" placeholder="New desk name" bind:value={newName} />
        <button class="btn primary" disabled={!newName.trim()} onclick={newDesk}
          ><Icon name="file" /> New blank desk</button
        >
        <button class="btn" onclick={importAsDesk}
          ><Icon name="upload" /> Import as new desk…</button
        >
      </div>
    </Panel>
  </Lockable>
</div>

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: grid;
    grid-template-columns: 1ch 1fr auto;
    align-items: center;
    gap: 1ch;
    padding: 6px 0.5ch;
    border-bottom: 1px dashed var(--line);
  }
  .mark {
    color: var(--fg-faint);
  }
  li.open .mark,
  li.open .name {
    color: var(--accent-text);
  }
  .info {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 1ch;
  }
  .row .input {
    flex: 1;
    min-width: 20ch;
  }
</style>
