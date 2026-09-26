<script lang="ts">
  // GLOBAL SETTINGS › LIBRARY: every saved desk preset on this device, open or not. Open one as a
  // desk, jump to an open one, delete, create a blank desk, or import a file as a new desk.
  import { open } from '@tauri-apps/plugin-dialog';
  import { presetStore } from '../lib/state/preset.svelte';
  import { confirmAction, errorText, showDesk, toast } from '../lib/state/ui.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import Lockable from '../lib/ui/Lockable.svelte';
  import Panel from '../lib/ui/Panel.svelte';

  let newName = $state('');

  async function run(what: string, fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (e) {
      toast(`${what} failed: ${errorText(e)}`, 'error');
    }
  }

  const goToDesk = (id: string) => {
    presetStore.activate(id);
    showDesk('controls');
  };

  const openAsDesk = (id: string, name: string) =>
    run('Open', async () => {
      const ok = await confirmAction({
        title: 'Open desk',
        message: `Open preset "${name}" as a new desk?`,
        details: ['Its outputs and inputs start immediately, alongside the open desks.'],
        confirmLabel: 'Open desk',
      });
      if (!ok) return;
      await presetStore.openDesk(id);
      toast(`Opened "${name}" as a desk`);
    });

  const newDesk = () =>
    run('Add desk', async () => {
      const name = newName.trim();
      const ok = await confirmAction({
        title: 'Add desk',
        message: `Create a new blank desk "${name}"?`,
        details: [
          'It gets one UDP output to 127.0.0.1:9000 and starts immediately, alongside the open desks.',
        ],
        confirmLabel: 'Add desk',
      });
      if (!ok) return;
      await presetStore.newDesk(name);
      newName = '';
      goToDesk(presetStore.current.id);
    });

  const importAsDesk = () =>
    run('Import', async () => {
      const path = await open({
        multiple: false,
        directory: false,
        filters: [{ name: 'OscOctopus preset', extensions: ['json'] }],
      });
      if (typeof path !== 'string') return;
      const ok = await confirmAction({
        title: 'Import as new desk',
        message: `Import ${path.split(/[\\/]/).pop()} and open it as a new desk?`,
        details: ['Its outputs and inputs start immediately, alongside the open desks.'],
        confirmLabel: 'Import & open',
      });
      if (!ok) return;
      await presetStore.importFile(path);
      toast(`Imported "${presetStore.current.name}" as a new desk`);
    });

  const removePreset = (id: string, name: string) =>
    run('Delete', async () => {
      const ok = await confirmAction({
        title: 'Delete preset',
        message: `Delete saved preset "${name}"? This cannot be undone.`,
        details: presetStore.isOpen(id)
          ? ['It is open as a desk: the desk is removed and its sockets close first.']
          : [],
        confirmLabel: 'Delete preset',
        danger: true,
      });
      if (ok) await presetStore.remove(id);
    });
</script>

<div class="library scroll">
  <Lockable>
    <Panel title="Saved desk presets · this device">
      {#snippet actions()}<span class="faint">{presetStore.summaries.length} saved</span>{/snippet}
      <ul>
        {#each presetStore.summaries as s (s.fileName)}
          {@const open = presetStore.isOpen(s.id)}
          <li class:open class:broken={s.error}>
            <span class="mark">{open ? '■' : '·'}</span>
            <div class="info">
              <span class="name">{s.name}</span>
              <span class="faint"
                >{s.fileName}{s.updatedAt
                  ? ` · ${new Date(s.updatedAt).toLocaleString()}`
                  : ''}</span
              >
              {#if s.error}<span class="err">{s.error}</span>{/if}
            </div>
            <div class="row">
              {#if open}
                <button class="btn" onclick={() => goToDesk(s.id)}>Go to desk</button>
              {:else if !s.error}
                <button class="btn" onclick={() => openAsDesk(s.id, s.name)}>Open as desk</button>
              {/if}
              <button
                class="btn icon ghost danger"
                title="Delete preset"
                onclick={() => removePreset(s.id, s.name)}><Icon name="trash" /></button
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
      <p class="faint">■ = open as a desk · stored in {presetStore.dir}</p>
    </Panel>
  </Lockable>
</div>

<style>
  .library {
    height: 100%;
    padding: 16px 2ch 32px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-width: 110ch;
    margin: 0 auto;
  }
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
  .name {
    font-weight: 700;
    text-transform: uppercase;
  }
  .err {
    color: var(--danger);
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
  p {
    margin: 0;
  }
</style>
