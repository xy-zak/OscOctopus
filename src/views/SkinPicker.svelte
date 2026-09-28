<script lang="ts">
  // One row per skin: ( ) NAME and a few widgets drawn in it. Picking one redraws the widgets
  // of every desk that doesn't have its own skin (DESK › PRESET). The skins made on this device
  // follow the built-in ones, each with its actions.
  import type { Snippet } from 'svelte';
  import SkinScope from '../lib/skins/SkinScope.svelte';
  import type { SkinInfo } from '../lib/skins/builtin';
  import { PREVIEW_WIDGETS } from '../lib/skins/preview';
  import { skinStore } from '../lib/state/skins.svelte';
  import Choice from '../lib/ui/Choice.svelte';
  import { viewsOf } from '../lib/widgets/registry';

  interface Props {
    /** Buttons for a user skin's row (export, delete). */
    actions?: Snippet<[SkinInfo]>;
  }
  let { actions }: Props = $props();

  const current = $derived(skinStore.global.id);
  const rows = $derived(skinStore.available);
</script>

<div class="skins" role="radiogroup" aria-label="Widget skin">
  {#each rows as skin, n (skin.id)}
    {#if skin.user && !rows[n - 1]?.user}<div class="group faint">YOURS</div>{/if}
    <div class="row">
      <Choice
        on={current === skin.id}
        name={skin.name}
        title={skin.note}
        nameWidth="17ch"
        padY="6px"
        onpick={() => skinStore.setGlobal(skin.id)}
      >
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
