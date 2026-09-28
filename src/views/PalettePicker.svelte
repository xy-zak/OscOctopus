<script lang="ts">
  // One row per palette: ( ) NAME ██████████. The palette of every desk (`desk` null, LOOK) or
  // of one desk (DESK › PRESET), whose list starts with ALL DESKS: it takes every desk's.
  // Picking one recolours what wears it (the CSS variables are registered, so it crossfades).
  // Custom palettes follow the built-in ones; in LOOK each has an EDIT button (`onedit`).
  import { appearance } from '../lib/state/appearance.svelte';
  import { lookStore } from '../lib/state/look.svelte';
  import type { Look } from '../lib/theme/look';
  import { PALETTE_IDS, PALETTES, type Palette } from '../lib/theme/palettes';
  import Choice from '../lib/ui/Choice.svelte';
  import Icon from '../lib/ui/Icon.svelte';

  interface Props {
    /** A desk's id, or null for every desk. */
    desk: string | null;
    /** EDIT on a custom palette. */
    onedit?: (id: string) => void;
    /** The custom palette open in the editor, if any. */
    editing?: string | null;
  }
  let { desk, onedit, editing = null }: Props = $props();

  const chosen = $derived(lookStore.chosen(desk, 'palette'));
  const all = $derived(lookStore.global.palette);
  const rows = $derived([
    ...PALETTE_IDS.map((id) => ({ id, palette: PALETTES[id] as Palette, custom: false })),
    ...appearance.theme.custom.map((p) => ({ id: p.id, palette: p as Palette, custom: true })),
  ]);
  /** EDIT buttons, so every row keeps room for one. */
  const editable = $derived(onedit !== undefined && appearance.theme.custom.length > 0);

  const pick = (id: string | null) => void lookStore.choose(desk, 'palette', id as Look['palette']);
</script>

{#snippet strip(palette: Palette, on: boolean)}
  <span class="strip" class:dim={!on}>
    {#each palette.colors as c, i (i)}<span style:background={c}></span>{/each}
  </span>
{/snippet}

<div class="palettes" role="radiogroup" aria-label="Palette">
  {#if desk !== null}
    <div class="row">
      <Choice
        on={chosen === null}
        name="ALL DESKS"
        title="The palette of every desk (GLOBAL SETTINGS › LOOK): {all.name}"
        onpick={() => pick(null)}
      >
        {@render strip(all, chosen === null)}
      </Choice>
    </div>
  {/if}
  {#each rows as { id, palette, custom }, n (id)}
    {#if custom && !rows[n - 1]?.custom}<div class="group faint">CUSTOM</div>{/if}
    <div class="row">
      <Choice on={chosen === id} name={palette.name} title={palette.note} onpick={() => pick(id)}>
        {@render strip(palette, chosen === id)}
      </Choice>
      {#if custom && onedit}
        <button
          type="button"
          class="btn ghost edit"
          class:open={editing === id}
          aria-label="Edit {palette.name}"
          title="Edit {palette.name}"
          onclick={() => onedit(id)}><Icon name="pencil" /> Edit</button
        >
      {:else if editable}
        <!-- Keeps every strip the same length as the custom rows'. -->
        <span class="edit" aria-hidden="true"></span>
      {/if}
    </div>
  {/each}
</div>

<style>
  .palettes {
    display: flex;
    flex-direction: column;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 1ch;
  }
  .group {
    margin: 8px 0 2px;
    padding-left: 0.5ch;
  }
  .strip {
    display: grid;
    grid-template-columns: repeat(10, 1fr);
    height: 12px;
  }
  .strip.dim {
    /* Unselected palettes read as dimmer, dithered previews. */
    mask: repeating-conic-gradient(#000 0 25%, #0008 0 50%) 0 0 / 2px 2px;
  }
  .edit {
    flex: none;
    width: 9ch;
    height: 24px;
  }
  .edit.open {
    border-color: var(--accent);
  }
</style>
