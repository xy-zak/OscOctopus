<script lang="ts">
  // Picks a saved desk to copy in as a sub-desk or a page (subdesk/actions.ts `embedDesk`):
  // every saved desk but the active one. Shared by the desk's toolbar and the sub-desk's
  // Inspector. It shows `placeholder` again once a desk is picked.
  import { presetStore } from '../../state/preset.svelte';

  interface Props {
    placeholder: string;
    /** Why it can't be used now, as its title (it is disabled while set). */
    refused?: string | null;
    /** Takes the room left in its row (else as wide as its text). */
    fill?: boolean;
    onpick: (presetId: string) => void;
  }
  let { placeholder, refused = null, fill = false, onpick }: Props = $props();

  const saved = $derived(
    presetStore.summaries.filter((s) => !s.error && s.id !== presetStore.current.id),
  );
</script>

{#if saved.length}
  <select
    class="input"
    class:fill
    aria-label={placeholder}
    title={refused ?? placeholder}
    disabled={!!refused}
    value=""
    onchange={(e) => {
      const id = e.currentTarget.value;
      e.currentTarget.value = '';
      if (id) onpick(id);
    }}
  >
    <option value="" disabled>{placeholder}</option>
    {#each saved as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
  </select>
{/if}

<style>
  select {
    flex: none;
    width: auto;
  }
  select.fill {
    flex: 1;
    min-width: 0;
  }
</style>
