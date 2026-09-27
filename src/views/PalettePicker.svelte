<script lang="ts">
  // One row per palette: ( ) NAME ██████████. The palette is global: picking one recolours
  // every desk (the CSS variables are registered, so it crossfades). Custom palettes follow the
  // built-in ones, each with an EDIT button.
  import { appearance } from '../lib/state/appearance.svelte';
  import { PALETTE_IDS, PALETTES, type Palette } from '../lib/theme/palettes';
  import Icon from '../lib/ui/Icon.svelte';

  interface Props {
    /** EDIT on a custom palette. */
    onedit: (id: string) => void;
    /** The custom palette open in the editor, if any. */
    editing?: string | null;
  }
  let { onedit, editing = null }: Props = $props();

  const theme = $derived(appearance.theme);
  const rows = $derived([
    ...PALETTE_IDS.map((id) => ({ id, palette: PALETTES[id] as Palette, custom: false })),
    ...theme.custom.map((p) => ({ id: p.id, palette: p as Palette, custom: true })),
  ]);
  const anyCustom = $derived(theme.custom.length > 0);

  function pick(id: string) {
    if (theme.palette !== id) void appearance.set({ palette: id as typeof theme.palette });
  }
</script>

<div class="palettes" role="radiogroup" aria-label="Palette">
  {#each rows as { id, palette, custom }, n (id)}
    {#if custom && !rows[n - 1]?.custom}<div class="group faint">CUSTOM</div>{/if}
    <div class="row">
      <button
        type="button"
        role="radio"
        aria-checked={theme.palette === id}
        class="pal"
        class:on={theme.palette === id}
        title={palette.note}
        onclick={() => pick(id)}
      >
        <span class="radio">{theme.palette === id ? '(•)' : '( )'}</span>
        <span class="name">{palette.name}</span>
        <span class="strip">
          {#each palette.colors as c, i (i)}<span style:background={c}></span>{/each}
        </span>
      </button>
      {#if custom}
        <button
          type="button"
          class="btn ghost edit"
          class:open={editing === id}
          aria-label="Edit {palette.name}"
          title="Edit {palette.name}"
          onclick={() => onedit(id)}><Icon name="pencil" /> Edit</button
        >
      {:else if anyCustom}
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
  .pal {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-columns: 3ch 12ch 1fr;
    gap: 1ch;
    align-items: center;
    padding: 3px 0.5ch;
    border: 1px solid transparent;
    background: none;
    color: var(--fg-dim);
    text-align: left;
    transition:
      border-color var(--t-ui) steps(2),
      color var(--t-ui) steps(2);
  }
  .pal:hover {
    color: var(--fg);
    border-color: var(--line);
  }
  .pal.on {
    color: var(--fg);
    border-color: var(--accent);
    font-weight: 700;
  }
  .radio {
    color: var(--accent-text);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .strip {
    display: grid;
    grid-template-columns: repeat(10, 1fr);
    height: 12px;
  }
  .pal:not(.on) .strip {
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
