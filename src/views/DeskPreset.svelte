<script lang="ts">
  // DESK › PRESET: this desk's own preset. Name, save, export, import into this desk
  // (replacing its contents), duplicate as a new desk, remove the desk.
  import { open, save } from '@tauri-apps/plugin-dialog';
  import { presetStore } from '../lib/state/preset.svelte';
  import { confirmAction, errorText, toast } from '../lib/state/ui.svelte';
  import Field from '../lib/ui/Field.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import Lockable from '../lib/ui/Lockable.svelte';
  import Panel from '../lib/ui/Panel.svelte';
  import Swatches from '../lib/ui/Swatches.svelte';

  const p = $derived(presetStore.current);

  const saveState = $derived.by(() => {
    if (presetStore.saving) return { cls: 'starting', text: 'saving' };
    if (presetStore.saveError) return { cls: 'error', text: presetStore.saveError };
    if (presetStore.dirty) return { cls: 'connecting', text: 'unsaved changes' };
    return {
      cls: 'ready',
      text: presetStore.lastSavedAt
        ? `saved ${new Date(presetStore.lastSavedAt).toLocaleTimeString()}`
        : 'saved',
    };
  });

  async function run(what: string, fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (e) {
      toast(`${what} failed: ${errorText(e)}`, 'error');
    }
  }

  const exportPreset = () =>
    run('Export', async () => {
      const safe = p.name.replace(/[^\w\- ]+/g, '').trim() || 'preset';
      const path = await save({
        defaultPath: `${safe}.json`,
        filters: [{ name: 'OscOctopus preset', extensions: ['json'] }],
      });
      if (!path) return;
      await presetStore.exportTo(path);
      toast(`Exported to ${path}`);
    });

  const importIntoDesk = () =>
    run('Import', async () => {
      const path = await open({
        multiple: false,
        directory: false,
        filters: [{ name: 'OscOctopus preset', extensions: ['json'] }],
      });
      if (typeof path !== 'string') return;
      const deskId = p.id;
      const ok = await confirmAction({
        title: 'Import into this desk',
        message: `Replace desk "${p.name}" with ${path.split(/[\\/]/).pop()}?`,
        details: [
          `Its ${p.widgets.length} widgets, grid and network settings are replaced by the file's.`,
          'Its outputs and inputs restart with the imported config.',
          'To keep this desk as it is, export it first, or use GLOBAL SETTINGS › LIBRARY › Import as new desk.',
        ],
        confirmLabel: 'Replace desk',
        danger: true,
      });
      if (!ok) return;
      await presetStore.importInto(deskId, path);
      toast(`Imported into "${presetStore.current.name}"`);
    });

  const duplicate = () =>
    run('Duplicate', async () => {
      const name = `${p.name} copy`;
      const ok = await confirmAction({
        title: 'Duplicate desk',
        message: `Open a copy of "${p.name}" as a new desk "${name}"?`,
        details: [
          'It starts immediately, alongside the open desks, and is saved as a new preset.',
          'Inputs on the same ports as the original will fail to bind; its NETWORK section will say so.',
        ],
        confirmLabel: 'Duplicate',
      });
      if (ok) await presetStore.duplicateDesk(name);
    });

  const removeDesk = () =>
    run('Remove desk', async () => {
      const ok = await confirmAction({
        title: 'Remove desk',
        message: `Remove desk "${p.name}" from the workspace?`,
        details: [
          'Its outputs and inputs stop and their sockets close.',
          'The preset stays saved: reopen it from + or GLOBAL SETTINGS › LIBRARY.',
        ],
        confirmLabel: 'Remove desk',
        danger: true,
      });
      if (ok) await presetStore.closeDesk(p.id);
    });
</script>

<div class="preset scroll">
  <Lockable>
    <Panel title="Desk preset" active tone="var(--scope)">
      {#snippet actions()}<span class="pill {saveState.cls}">{saveState.text}</span>{/snippet}
      <div class="grid">
        <Field label="Name" wide>
          <input class="input" bind:value={p.name} oninput={() => presetStore.touch()} />
        </Field>
        <Field label="Desk colour (tab + frame)" wide>
          <Swatches
            value={p.color}
            allowAuto={false}
            onchange={(c) => {
              p.color = c ?? 0;
              presetStore.touch();
            }}
          />
        </Field>
        <Field label="Grid">
          <span class="readout">{p.grid.cols}×{p.grid.rows} · gap {p.grid.gap}px</span>
        </Field>
        <Field label="Contents">
          <span class="readout"
            >{p.widgets.length} widgets · {p.network.outputs.length} out · {p.network.inputs.length} in</span
          >
        </Field>
      </div>
      <div class="actions">
        <button class="btn" onclick={() => run('Save', () => presetStore.save())}
          ><Icon name="save" /> Save now</button
        >
        <button class="btn" onclick={exportPreset}><Icon name="download" /> Export…</button>
        <button class="btn" onclick={importIntoDesk}
          ><Icon name="upload" /> Import into this desk…</button
        >
      </div>
      <p class="faint">
        Saves automatically. id {p.id} · created {new Date(p.createdAt).toLocaleString()} · schema v{p.schemaVersion}
      </p>
    </Panel>

    <Panel title="This desk in the workspace">
      <div class="actions">
        <button class="btn" onclick={duplicate}><Icon name="copy" /> Duplicate as new desk</button>
        <button class="btn danger" disabled={presetStore.desks.length <= 1} onclick={removeDesk}
          ><Icon name="close" /> Remove desk</button
        >
      </div>
      {#if presetStore.desks.length <= 1}
        <p class="faint">The last open desk can't be removed.</p>
      {/if}
    </Panel>
  </Lockable>
</div>

<style>
  .preset {
    height: 100%;
    padding: 16px 2ch 32px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-width: 110ch;
    margin: 0 auto;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(24ch, 1fr));
    gap: 10px 2ch;
  }
  .actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 1ch;
  }
  .readout {
    line-height: var(--control-h);
  }
  p {
    margin: 0;
  }
</style>
