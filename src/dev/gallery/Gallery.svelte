<script lang="ts">
  // Dev gallery: every widget scenario (scenarios.ts) on its own stage, live, so it can be
  // pressed and dragged, in one skin. With `only`, just that one
  // (the screenshot script shows one at a time). Values and lit pads are seeded into the real
  // stores before the widgets mount.
  import SkinScope from '../../lib/skins/SkinScope.svelte';
  import type { SkinInfo } from '../../lib/skins/builtin';
  import { feedback } from '../../lib/state/feedback.svelte';
  import { values } from '../../lib/state/values.svelte';
  import { viewsOf } from '../../lib/widgets/registry';
  import { SCENARIOS } from './scenarios';

  let { only = null, skin }: { only?: string | null; skin: SkinInfo } = $props();

  const shown = $derived(only ? SCENARIOS.filter((s) => s.id === only) : SCENARIOS);

  for (const s of SCENARIOS) {
    if (s.value !== undefined) values[s.widget.id] = s.value;
    else delete values[s.widget.id];
    feedback.padLit[s.widget.id] = Object.fromEntries((s.lit ?? []).map((n) => [n, true]));
    delete feedback.padFlash[s.widget.id];
  }
</script>

<SkinScope {skin}>
  <main class="gallery" class:single={only !== null}>
    {#each shown as s (s.id)}
      {@const Widget = viewsOf(s.widget).component}
      <figure>
        <!-- The shot: the stage plus a margin for the shadow and the labels in the border. -->
        <div class="shot" data-shot={s.id}>
          <div class="stage" style:width="{s.size[0]}px" style:height="{s.size[1]}px">
            <Widget widget={s.widget} live={true} />
          </div>
        </div>
        {#if only === null}<figcaption class="faint">{s.id}</figcaption>{/if}
      </figure>
    {/each}
  </main>
</SkinScope>

<style>
  .gallery {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 8px 16px;
    padding: 16px;
  }
  figure {
    margin: 0;
  }
  .shot {
    padding: 14px;
  }
  .stage {
    position: relative;
  }
  figcaption {
    padding: 0 14px;
  }
</style>
