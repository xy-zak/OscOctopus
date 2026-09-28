<script lang="ts">
  // The ACTIVE colour (what pressed, on, filled and held widgets turn) of every desk (`desk`
  // null, LOOK) or of one desk (DESK › PRESET): GREEN, the standard one in no palette, or one of
  // the palette's ten. A desk's choices start with ALL DESKS: it takes every desk's.
  import { lookStore } from '../lib/state/look.svelte';
  import { ACTIVE_GREEN, activeSwatch } from '../lib/theme/look';
  import Swatches, { type SwatchExtra } from '../lib/ui/Swatches.svelte';

  let { desk }: { desk: string | null } = $props();

  const chosen = $derived(lookStore.chosen(desk, 'active'));
  const extras = $derived<SwatchExtra<typeof ACTIVE_GREEN | null>[]>([
    ...(desk === null
      ? []
      : [
          {
            value: null,
            label: 'ALL DESKS',
            title: 'The ACTIVE colour of every desk (GLOBAL SETTINGS › LOOK)',
            color: activeSwatch(lookStore.global),
          },
        ]),
    {
      value: ACTIVE_GREEN,
      label: 'GREEN',
      title: 'GREEN: the standard ACTIVE colour, the same in every palette',
      color: 'var(--ok)',
    },
  ]);
</script>

<Swatches value={chosen} {extras} onchange={(v) => lookStore.choose(desk, 'active', v)} />
