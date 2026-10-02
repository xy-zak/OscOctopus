<script lang="ts">
  // A sub-desk's page, drawn inside the sub-desk with the canvas it sits on (context.ts). The
  // same desk, played the same way; never edited here: in EDIT a page is opened on the desk's
  // canvas instead, so this only shows what is on it.
  import type { PageRef } from '../model/subdesks';
  import { useCanvas } from './context';
  import GridCanvas from './GridCanvas.svelte';

  let { page }: { page: PageRef } = $props();

  const around = useCanvas()!;
  const ctx = $derived(around());
  const nothing = () => {};
</script>

<GridCanvas
  preset={ctx.preset}
  {page}
  index={ctx.index}
  editing={false}
  selectedId={null}
  focusedId={ctx.focusedId}
  onselect={nothing}
  onfocus={ctx.onfocus}
  oncommit={nothing}
  locked={ctx.locked || ctx.editing}
/>
