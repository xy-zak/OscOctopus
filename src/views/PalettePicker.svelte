<script lang="ts">
  // One row per palette: ( ) NAME ██████████. The palette is global: picking one recolours
  // every desk (the CSS variables are registered, so it crossfades).
  import { appearance } from '../lib/state/appearance.svelte';
  import { PALETTE_IDS, PALETTES, type PaletteId } from '../lib/theme/palettes';

  const theme = $derived(appearance.theme);

  function pick(id: PaletteId) {
    if (theme.palette !== id) void appearance.set({ palette: id });
  }
</script>

<div class="palettes" role="radiogroup">
  {#each PALETTE_IDS as id (id)}
    <button
      type="button"
      role="radio"
      aria-checked={theme.palette === id}
      class="pal"
      class:on={theme.palette === id}
      onclick={() => pick(id)}
    >
      <span class="radio">{theme.palette === id ? '(•)' : '( )'}</span>
      <span class="name">{PALETTES[id].name}</span>
      <span class="strip">
        {#each PALETTES[id].colors as c, i (i)}<span style:background={c}></span>{/each}
      </span>
    </button>
  {/each}
</div>

<style>
  .palettes {
    display: flex;
    flex-direction: column;
  }
  .pal {
    display: grid;
    grid-template-columns: 3ch 11ch 1fr;
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
  .strip {
    display: grid;
    grid-template-columns: repeat(10, 1fr);
    height: 12px;
  }
  .pal:not(.on) .strip {
    /* Unselected palettes read as dimmer, dithered previews. */
    mask: repeating-conic-gradient(#000 0 25%, #0008 0 50%) 0 0 / 2px 2px;
  }
</style>
