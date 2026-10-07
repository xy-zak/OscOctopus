<script lang="ts">
  // One row per skin: ( ) NAME and a few widgets drawn in it, in the colours of the look around
  // the picker. The skin of every desk (`desk` null, LOOK) or of one desk (DESK › LOOK), whose
  // list starts with ALL DESKS: it takes every desk's. The skins made on this device follow the
  // built-in ones, each with its actions.
  import type { Snippet } from 'svelte';
  import SkinScope from '../lib/skins/SkinScope.svelte';
  import type { SkinInfo } from '../lib/skins/builtin';
  import { PREVIEW_WIDGETS } from '../lib/skins/preview';
  import { lookStore } from '../lib/state/look.svelte';
  import { skinStore } from '../lib/state/skins.svelte';
  import Choice from '../lib/ui/Choice.svelte';
  import { viewsOf } from '../lib/widgets/registry';

  interface Props {
    /** A desk's id, or null for every desk. */
    desk: string | null;
    /** Buttons for a user skin's row (export, delete). */
    actions?: Snippet<[SkinInfo]>;
  }
  let { desk, actions }: Props = $props();

  const chosen = $derived(lookStore.chosen(desk, 'skin'));
  const all = $derived(lookStore.global.skin);
  const rows = $derived(skinStore.available);
</script>

{#snippet preview(skin: SkinInfo)}
  <!-- A picture of the skin, not controls: out of the tab order and the a11y tree. -->
  <span class="preview" aria-hidden="true" inert>
    <SkinScope {skin}>
      {#each PREVIEW_WIDGETS as p (p.widget.id)}
        {@const Widget = viewsOf(p.widget).component}
        <span class="stage" style:width="{p.size[0]}px" style:height="{p.size[1]}px">
          <Widget widget={p.widget} live={false} />
        </span>
      {/each}
    </SkinScope>
  </span>
{/snippet}

<div class="skins" role="radiogroup" aria-label="Widget skin">
  {#if desk !== null}
    <div class="row">
      <Choice
        on={chosen === null}
        name="ALL DESKS"
        tip="The skin of every desk (GLOBAL SETTINGS › LOOK): {all.name}"
        nameWidth="17ch"
        padY="6px"
        onpick={() => lookStore.choose(desk, 'skin', null)}
      >
        {@render preview(all)}
      </Choice>
    </div>
  {/if}
  {#each rows as skin, n (skin.id)}
    {#if skin.user && !rows[n - 1]?.user}<div class="group faint">YOURS</div>{/if}
    <div class="row">
      <Choice
        on={chosen === skin.id}
        name={skin.name}
        tip={skin.note}
        nameWidth="17ch"
        padY="6px"
        onpick={() => lookStore.choose(desk, 'skin', skin.id)}
      >
        {@render preview(skin)}
      </Choice>
      {#if skin.user && actions}<span class="actions">{@render actions(skin)}</span>{/if}
    </div>
  {/each}
</div>

<style>
  .skins {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .group {
    margin: 8px 0 2px;
    padding-left: 0.5ch;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 1ch;
  }
  .preview {
    display: flex;
    gap: 14px;
    /* Room for the labels set into the frames' borders and their shadows. */
    padding: 8px 8px 6px;
    overflow: hidden;
    pointer-events: none;
  }
  /* The row's own text colour and weight must not leak into the widgets. */
  .stage {
    position: relative;
    flex: none;
    color: var(--fg);
    font-weight: 400;
  }
  .actions {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
</style>
