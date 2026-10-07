<script lang="ts">
  // GLOBAL SETTINGS › LOOK: the look of every desk (theme/look.ts): its palette, ACTIVE colour
  // and widget skin, which a desk can make its own (DESK › LOOK, the same pickers). Widgets and
  // desk identity colours are palette indices, so changing the palette recolours them (it
  // crossfades), and so does the accent each palette brings. Also here, for all desks: the
  // background, the custom palettes (made from one source colour, PaletteEditor) and the skins
  // made on this device (import, export, delete).
  import { appearance } from '../lib/state/appearance.svelte';
  import { skinStore } from '../lib/state/skins.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import Lockable from '../lib/ui/Lockable.svelte';
  import Panel from '../lib/ui/Panel.svelte';
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

<div class="page scroll">
  <Lockable>
    <Panel
      title="Background · all desks"
      hint="Dark (default) is near-black with near-white text; light is the inverse. The palette colours stay the same in both."
    >
      <Segmented
        options={[
          { value: 'dark', label: '■ DARK' },
          { value: 'light', label: '□ LIGHT' },
        ]}
        value={appearance.theme.mode}
        onchange={(mode) => appearance.set({ mode })}
      />
    </Panel>

    <Panel
      title="Palette · all desks"
      hint="Each palette is nine colours and an accent (the last, set apart). The accent marks highlights and selection. Widgets and each desk's identity colour pick one of all ten (widgets can also use AUTO: their desk's colour). A desk can have its own palette (DESK › LOOK)."
    >
      <PalettePicker desk={null} {editing} onedit={(id) => (editing = id)} />
      <!-- Right under the list, where the new palette will appear. -->
      <div class="new">
        <button
          class="btn"
          disabled={editing !== null || appearance.customFull}
          data-tip="Make your own: pick one colour, and nine and an accent are made from it."
          onclick={() => (editing = 'new')}><Icon name="plus" /> New palette</button
        >
        {#if appearance.customFull}<span class="faint">{PALETTES_FULL}</span>{/if}
      </div>
    </Panel>

    {#if editing !== null && (editing === 'new' || editingPalette)}
      <!-- Keyed, so switching to another palette starts a fresh draft. -->
      {#key editing}
        <PaletteEditor palette={editingPalette} onclose={() => (editing = null)} />
      {/key}
    {/if}

    <Panel
      title="Active colour · all desks"
      hint="What is pressed, on, filled or held turns this colour, in every palette. Pick one your widgets don't use, so it stands out. A desk can have its own (DESK › LOOK)."
    >
      <ActivePicker desk={null} />
    </Panel>

    <Panel
      title="Widget skin · all desks"
      hint="How widgets are drawn: their shapes, lines, fills and motion. The palette and the active colour still colour them, and the text, the markers and the background stay the same in every skin. A desk can have its own skin (DESK › LOOK)."
    >
      <SkinPicker desk={null}>
        {#snippet actions(skin)}
          <button
            class="btn ghost"
            aria-label="Export {skin.name}"
            data-tip="Save {skin.name} as a file, to use on another device or share"
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
        <label class="btn" data-tip="A skin file exported on another device, or shared with you."
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
      </div>
      {#each skinStore.problems as p (p.id)}
        <div class="problem">
          <span class="warn">Can't use the skin file {p.id}: {p.error}</span>
          <button class="btn ghost danger" onclick={() => deleteSkin(p.id, p.id)}
            ><Icon name="trash" /> Delete</button
          >
        </div>
      {/each}
    </Panel>
  </Lockable>
</div>

<style>
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
