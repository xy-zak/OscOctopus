<script lang="ts">
  // A frame's shown tab, drawn inside the frame with the canvas of the desk it sits on
  // (context.ts): the same desk, edited and played the same way, with its selection and its drag.
  import type { TabRef } from '../model/preset';
  import { useCanvas } from './context';
  import GridCanvas from './GridCanvas.svelte';

  let { tab }: { tab: TabRef } = $props();

  const around = useCanvas()!;
  const ctx = $derived(around());
</script>

<GridCanvas
  preset={ctx.preset}
  {tab}
  index={ctx.index}
  drag={ctx.drag}
  editing={ctx.editing}
  locked={ctx.locked}
  selected={ctx.selected}
  focusedId={ctx.focusedId}
  onselect={ctx.onselect}
  onpick={ctx.onpick}
  onfocus={ctx.onfocus}
  holderOf={ctx.holderOf}
/>
