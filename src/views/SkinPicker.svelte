<script lang="ts">
  // One row per skin: ( ) NAME and a few widgets drawn in it. Picking one redraws the widgets
  // of every desk that doesn't have its own skin (DESK › PRESET). The skins made on this device
  // follow the built-in ones, each with its actions.
  import type { Snippet } from 'svelte';
  import SkinScope from '../lib/skins/SkinScope.svelte';
  import type { SkinInfo } from '../lib/skins/builtin';
  import { PREVIEW_WIDGETS } from '../lib/skins/preview';
  import { skinStore } from '../lib/state/skins.svelte';
  import { viewsOf } from '../lib/widgets/registry';

  interface Props {
    /** Buttons for a user skin's row (edit, export, delete). */
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
      <button
        type="button"
        role="radio"
        aria-checked={current === skin.id}
        class="skin"
        class:on={current === skin.id}
        title={skin.note}
        onclick={() => current !== skin.id && skinStore.setGlobal(skin.id)}
      >
        <span class="radio">{current === skin.id ? '(•)' : '( )'}</span>
        <span class="name">{skin.name}</span>
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
      </button>
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
  .skin {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-columns: 3ch 17ch 1fr;
    gap: 1ch;
    align-items: center;
    padding: 6px 0.5ch;
    border: 1px solid transparent;
    background: none;
    color: var(--fg-dim);
    text-align: left;
    transition:
      border-color var(--t-ui) steps(2),
      color var(--t-ui) steps(2);
  }
  .skin:hover {
    color: var(--fg);
    border-color: var(--line);
  }
  .skin.on {
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
