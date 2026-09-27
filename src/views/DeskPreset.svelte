<script lang="ts">
  // DESK › PRESET: this desk's own preset. Name, save, export, import into this desk
  // (replacing its contents), duplicate as a new desk, remove the desk.
  import { presetStore } from '../lib/state/preset.svelte';
  import { skinStore } from '../lib/state/skins.svelte';
  import Field from '../lib/ui/Field.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import Lockable from '../lib/ui/Lockable.svelte';
  import Panel from '../lib/ui/Panel.svelte';
  import Swatches from '../lib/ui/Swatches.svelte';
  import { duplicateDesk, exportDesk, importIntoDesk, removeDesk, saveDesk } from './deskActions';

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
        <Field label="Widget skin" hint="Just on this device, like the palette" wide>
          <select
            class="input"
            value={skinStore.overrideOf(p.id) ?? ''}
            onchange={(e) => skinStore.setDesk(p.id, e.currentTarget.value || null)}
          >
            <option value="">Same as all desks ({skinStore.global.name})</option>
            {#each skinStore.available as s (s.id)}
              <option value={s.id}>{s.name}</option>
            {/each}
          </select>
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
        <button class="btn" onclick={saveDesk}><Icon name="save" /> Save now</button>
        <button class="btn" onclick={exportDesk}><Icon name="download" /> Export…</button>
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
        <button class="btn" onclick={duplicateDesk}
          ><Icon name="copy" /> Duplicate as new desk</button
        >
        <button
          class="btn danger"
          disabled={presetStore.desks.length <= 1}
          onclick={() => removeDesk(p.id)}><Icon name="close" /> Remove desk</button
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
