<script lang="ts">
  // The ACTIVE colour (what pressed, on, filled and held widgets turn) of every desk (`desk`
  // null, LOOK) or of one desk (DESK › LOOK): any colour, from the system's colour picker or
  // typed as a hex code. GREEN is the default. A desk takes every desk's until it picks its own;
  // ALL DESKS gives it every desk's again.
  import { lookStore } from '../lib/state/look.svelte';
  import { DEFAULT_ACTIVE } from '../lib/theme/look';
  import ColorField from '../lib/ui/ColorField.svelte';
  import Icon from '../lib/ui/Icon.svelte';

  let { desk }: { desk: string | null } = $props();

  const shown = $derived(desk === null ? lookStore.global.active : lookStore.forDesk(desk).active);
</script>

<span class="active">
  <!-- Shown while the picker moves, saved once it settles. -->
  <ColorField
    value={shown}
    label="Active colour"
    oninput={(hex) => lookStore.choose(desk, 'active', hex, false)}
    onchange={(hex) => lookStore.choose(desk, 'active', hex)}
  />
  {#if desk === null}
    <button
      type="button"
      class="btn ghost"
      disabled={shown === DEFAULT_ACTIVE}
      data-tip="Back to the default green"
      onclick={() => lookStore.choose(null, 'active', DEFAULT_ACTIVE)}
      ><Icon name="refresh" /> Green</button
    >
  {:else}
    <button
      type="button"
      class="btn ghost"
      disabled={lookStore.chosen(desk, 'active') === null}
      data-tip="The active colour of every desk (GLOBAL SETTINGS › LOOK)"
      onclick={() => lookStore.choose(desk, 'active', null)}
      ><Icon name="refresh" /> All desks</button
    >
  {/if}
</span>

<style>
  .active {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1ch;
  }
</style>
