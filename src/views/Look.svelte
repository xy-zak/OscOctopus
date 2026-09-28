<script lang="ts">
  // GLOBAL SETTINGS › LOOK: the look of every desk (theme/look.ts): its palette, ACTIVE colour
  // and widget skin, which a desk can make its own (DESK › PRESET, the same pickers). Widgets and
  // desk identity colours are palette indices, so changing the palette recolours them (it
  // crossfades). Also here, for all desks: the background and the accent, the custom palettes
  // (made from one source colour, PaletteEditor) and the skins made on this device (import,
  // export, delete).
  import { appearance } from '../lib/state/appearance.svelte';
  import { lookStore } from '../lib/state/look.svelte';
  import { skinStore } from '../lib/state/skins.svelte';
  import Field from '../lib/ui/Field.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import Lockable from '../lib/ui/Lockable.svelte';
  import Panel from '../lib/ui/Panel.svelte';
  import Swatches from '../lib/ui/Swatches.svelte';
  import Segmented from '../lib/ui/Segmented.svelte';
  import ActivePicker from './ActivePicker.svelte';
  import PaletteEditor from './PaletteEditor.svelte';
  import PalettePicker from './PalettePicker.svelte';
  import SkinPicker from './SkinPicker.svelte';
  import { deleteSkin, exportSkin, importSkinFile, PALETTES_FULL } from './lookActions';

  /** What the editor has open: a custom palette's id, a new one, or nothing. */
  let editing = $state<string | 'new' | null>(null);
  const editingPalette = $derived(
    editing && editing !== 'new'
      ? (appearance.theme.custom.find((p) => p.id === editing) ?? null)
      : null,
  );
</script>

<div class="look scroll">
  <Lockable>
    <Panel title="Background · all desks">
      <Segmented
        options={[
          { value: 'dark', label: '■ DARK' },
          { value: 'light', label: '□ LIGHT' },
        ]}
        value={appearance.theme.mode}
        onchange={(mode) => appearance.set({ mode })}
      />
      <p class="faint">
        Dark (default) is near-black with near-white text; light is the inverse. The palette colours
        stay the same in both.
      </p>
    </Panel>

    <Panel title="Palette · all desks">
      <PalettePicker desk={null} {editing} onedit={(id) => (editing = id)} />
      <!-- Right under the list, where the new palette will appear. -->
      <div class="new">
        <button
          class="btn"
          disabled={editing !== null || appearance.customFull}
          onclick={() => (editing = 'new')}><Icon name="plus" /> New palette</button
        >
        <span class="faint">
          {appearance.customFull
            ? PALETTES_FULL
            : 'Make your own: pick one colour and ten are made from it.'}
        </span>
      </div>
      <Field label="Active colour ({lookStore.global.palette.name})" group>
        <ActivePicker desk={null} />
      </Field>
      <Field label="Accent ({lookStore.global.palette.name})" group>
        <Swatches
          value={appearance.theme.accent}
          onchange={(accent) => appearance.set({ accent })}
        />
      </Field>
      <p class="faint">
        Widgets and each desk's identity colour pick one of the palette's ten colours (widgets can
        also use AUTO: their desk's colour). What is pressed, on, filled or held turns the active
        colour: pick one your widgets don't use, so it stands out. The accent is for highlights and
        selection. A desk can have its own palette and active colour (DESK › PRESET).
      </p>
    </Panel>

    {#if editing !== null && (editing === 'new' || editingPalette)}
      <!-- Keyed, so switching to another palette starts a fresh draft. -->
      {#key editing}
        <PaletteEditor palette={editingPalette} onclose={() => (editing = null)} />
      {/key}
    {/if}

    <Panel title="Widget skin · all desks">
      <SkinPicker desk={null}>
        {#snippet actions(skin)}
          <button
            class="btn ghost"
            aria-label="Export {skin.name}"
            title="Save {skin.name} as a file, to use on another device or share"
            onclick={() => exportSkin(skin.id)}><Icon name="download" /> Export</button
          >
          <button
            class="btn ghost danger"
            aria-label="Delete {skin.name}"
            onclick={() => deleteSkin(skin.id, skin.name)}><Icon name="trash" /> Delete</button
          >
        {/snippet}
      </SkinPicker>
      <div class="new">
        <label class="btn"
          ><Icon name="upload" /> Import skin…<input
            type="file"
            accept=".json,application/json"
            hidden
            onchange={(e) => {
              const input = e.currentTarget;
              const file = input.files?.[0];
              input.value = '';
              if (file) void importSkinFile(file);
            }}
          /></label
        >
        <span class="faint">A skin file exported on another device, or shared with you.</span>
      </div>
      {#each skinStore.problems as p (p.id)}
        <div class="problem">
          <span class="warn">Can't use the skin file {p.id}: {p.error}</span>
          <button class="btn ghost danger" onclick={() => deleteSkin(p.id, p.id)}
            ><Icon name="trash" /> Delete</button
          >
        </div>
      {/each}
      <p class="faint">
        How widgets are drawn: their shapes, lines, fills and motion. The palette and the active
        colour still colour them, and the text, the markers and the background stay the same in
        every skin. A desk can have its own skin (DESK › PRESET).
      </p>
    </Panel>
  </Lockable>
</div>

<style>
  .look {
    height: 100%;
    padding: 16px 2ch 32px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-width: 110ch;
    margin: 0 auto;
  }
  p {
    margin: 0;
  }
  .new,
  .problem {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1ch 2ch;
  }
  .warn {
    color: var(--warn);
  }
</style>
