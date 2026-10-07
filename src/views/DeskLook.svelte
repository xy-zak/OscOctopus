<script lang="ts">
  // DESK › LOOK: this desk's own preset and look. Name, colour, save, export, import into this
  // desk (replacing its contents), duplicate as a new desk, remove the desk. And its look on this
  // device: the pickers of GLOBAL SETTINGS › LOOK, for this desk (theme/look.ts).
  import { lookStore } from '../lib/state/look.svelte';
  import { presetStore } from '../lib/state/preset.svelte';
  import { showGlobal } from '../lib/state/ui.svelte';
  import type { LookField } from '../lib/theme/look';
  import Field from '../lib/ui/Field.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import Lockable from '../lib/ui/Lockable.svelte';
  import Panel from '../lib/ui/Panel.svelte';
  import Swatches from '../lib/ui/Swatches.svelte';
  import ActivePicker from './ActivePicker.svelte';
  import { duplicateDesk, exportDesk, importIntoDesk, removeDesk, saveDesk } from './deskActions';
  import PalettePicker from './PalettePicker.svelte';
  import SkinPicker from './SkinPicker.svelte';

  const p = $derived(presetStore.current);
  const look = $derived(lookStore.forDesk(p.id));
  /** Where a look choice comes from, for its label. */
  const from = (field: LookField) =>
    lookStore.chosen(p.id, field) === null ? 'all desks' : 'this desk';

  const saveState = $derived.by(() => {
    if (presetStore.saving) return { cls: 'off', text: 'saving' };
    if (presetStore.saveError) return { cls: 'bad', text: presetStore.saveError };
    if (presetStore.dirty) return { cls: 'off', text: 'unsaved changes' };
    return {
      cls: 'ok',
      text: presetStore.lastSavedAt
        ? `saved ${new Date(presetStore.lastSavedAt).toLocaleTimeString()}`
        : 'saved',
    };
  });
</script>

<div class="page scroll">
  <Lockable>
    <Panel
      title="Desk preset"
      hint="The desk as a file: it saves automatically, and Export… makes a copy to use elsewhere."
    >
      {#snippet actions()}<span class="pill {saveState.cls}">{saveState.text}</span>{/snippet}
      <div class="grid">
        <Field label="Name" wide>
          <input class="input" bind:value={p.name} oninput={() => presetStore.touch()} />
        </Field>
        <Field label="Desk colour (tab + frame) · {look.palette.name}" group wide>
          <Swatches
            value={p.color}
            onchange={(c) => {
              p.color = c;
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
        <button class="btn" onclick={saveDesk}><Icon name="save" /> Save now</button>
        <button class="btn" onclick={exportDesk}><Icon name="download" /> Export…</button>
        <button class="btn" onclick={importIntoDesk}
          ><Icon name="upload" /> Import into this desk…</button
        >
      </div>
      <p class="faint">
        id {p.id} · created {new Date(p.createdAt).toLocaleString()} · schema v{p.schemaVersion}
      </p>
    </Panel>

    <Panel
      title="Look · this desk"
      hint="ALL DESKS follows GLOBAL SETTINGS › LOOK. Just on this device: a desk shared with others looks the way each of them chose, and an exported preset carries none of it. The desk colour and the widgets' colours are in the preset."
    >
      {#snippet actions()}
        <button
          class="btn ghost"
          disabled={!lookStore.hasOwn(p.id)}
          data-tip="Palette, active colour and skin of all desks"
          onclick={() => lookStore.resetDesk(p.id)}>Same as all desks</button
        >
      {/snippet}
      <div class="look">
        <Field label="Palette · {look.palette.name} ({from('palette')})" group>
          <PalettePicker desk={p.id} />
        </Field>
        <Field label="Active colour ({from('active')})" group>
          <ActivePicker desk={p.id} />
        </Field>
        <Field label="Widget skin · {look.skin.name} ({from('skin')})" group>
          <SkinPicker desk={p.id} />
        </Field>
      </div>
      <p class="faint">
        Palettes and skins are made, imported and deleted in <button
          class="link"
          onclick={() => showGlobal('look')}>GLOBAL SETTINGS › LOOK</button
        >.
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
  .look {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  p {
    margin: 0;
  }
</style>
