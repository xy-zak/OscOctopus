<script lang="ts">
  // INTERACTION for a sub-desk: its pages (tabs), in order. Each can be opened on the canvas
  // to edit what is on it, renamed, moved, removed, sent to one of the desk's outputs, and, if
  // it was copied from a saved desk, copied again (Update from LIBRARY). New pages are blank or
  // copied from a saved desk.
  import { sends, sendsTo } from '../../model/embed';
  import { LIMITS, type SubdeskPage, type SubdeskWidget } from '../../model/preset';
  import { widgetsUnder } from '../../model/subdesks';
  import { presetStore } from '../../state/preset.svelte';
  import Field from '../../ui/Field.svelte';
  import Icon from '../../ui/Icon.svelte';
  import SavedDeskField from '../fields/SavedDeskField.svelte';
  import { embedDesk, removePage } from './actions';
  import { pageName, pagesFull, TOO_MANY_PAGES } from './def';

  let { widget = $bindable(), onchange }: { widget: SubdeskWidget; onchange: () => void } =
    $props();

  const desk = $derived(presetStore.current);
  const outputs = $derived(desk.network.outputs);
  const full = $derived(pagesFull(widget));

  /** Renames a page as typed; an empty name keeps the old one. */
  function rename(page: SubdeskPage, text: string) {
    const name = pageName(text);
    if (!name || name === page.name) return;
    page.name = name;
    onchange();
  }

  /**
   * Where a page's widgets send: one output's id, 'mixed', '' (nowhere yet), or null when
   * nothing on it sends at all (no *Send to* then).
   */
  function sending(page: SubdeskPage): string | null {
    const on = widgetsUnder(desk, { widget: widget.id, page: page.id });
    if (!on.some(sends)) return null;
    const ids = sendsTo(on);
    return ids.length === 1 ? ids[0]! : ids.length ? 'mixed' : '';
  }

  /** The saved desk a page was copied from, and whether it changed since. */
  function sourceOf(page: SubdeskPage) {
    const s = page.source ? presetStore.summaries.find((x) => x.id === page.source) : undefined;
    return s && { name: s.name, changed: !!s.updatedAt && s.updatedAt !== page.copiedAt };
  }
</script>

<section class="pages">
  {#each widget.props.pages as page, i (page.id)}
    {@const from = sourceOf(page)}
    {@const sends = sending(page)}
    <div class="page">
      <div class="head">
        <input
          class="input name"
          aria-label="Page {i + 1} name"
          maxlength={LIMITS.pageName.max}
          value={page.name}
          onchange={(e) => {
            rename(page, e.currentTarget.value);
            e.currentTarget.value = page.name;
          }}
        />
        <button
          class="btn icon"
          title="Open this page to edit what is on it"
          onclick={() => presetStore.openPage({ widget: widget.id, page: page.id })}
          ><Icon name="open" /></button
        >
        <button
          class="btn icon"
          title="Earlier"
          disabled={i === 0}
          onclick={() => presetStore.movePage(widget.id, page.id, -1)}>‹</button
        >
        <button
          class="btn icon"
          title="Later"
          disabled={i === widget.props.pages.length - 1}
          onclick={() => presetStore.movePage(widget.id, page.id, 1)}>›</button
        >
        <button
          class="btn icon danger"
          title="Remove this page"
          disabled={widget.props.pages.length <= 1}
          onclick={() => removePage(widget.id, page.id)}><Icon name="trash" /></button
        >
      </div>
      {#if outputs.length && sends !== null}
        <label class="line">
          <span class="faint">Send to</span>
          <select
            class="input"
            value={sends}
            onchange={(e) => {
              if (e.currentTarget.value)
                presetStore.routePage(widget.id, page.id, e.currentTarget.value);
            }}
          >
            {#if sends === 'mixed'}<option value="mixed" disabled>Several outputs</option>{/if}
            {#if sends === ''}<option value="" disabled>Nowhere</option>{/if}
            {#each outputs as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
          </select>
        </label>
      {/if}
      {#if page.source}
        <div class="line faint">
          {#if from}
            from LIBRARY › {from.name}{#if from.changed}<span class="changed">
                · changed since copied</span
              >{/if}
            <button
              class="btn ghost"
              title="Copy it again over this page"
              onclick={() =>
                embedDesk(page.source!, { kind: 'update', widget: widget.id, page: page.id })}
              ><Icon name="refresh" /> Update</button
            >
          {:else}
            copied from a desk that is no longer saved here
          {/if}
        </div>
      {/if}
    </div>
  {/each}

  <Field
    label="Add a page"
    hint={full ? TOO_MANY_PAGES : 'Blank, or a copy of a saved desk'}
    group
    wide
  >
    <span class="add">
      <button class="btn" disabled={full} onclick={() => presetStore.addBlankPage(widget.id)}
        ><Icon name="plus" /> Blank</button
      >
      <SavedDeskField
        placeholder="From LIBRARY…"
        refused={full ? TOO_MANY_PAGES : null}
        fill
        onpick={(id) => embedDesk(id, { kind: 'page', widget: widget.id })}
      />
    </span>
  </Field>
  <p class="faint">
    Tabs show only on this device: everyone picks their own. Open a page (<Icon name="open" />, or
    double-tap the sub-desk) to add, move and edit what is on it.
  </p>
</section>

<style>
  .pages {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .page {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-left: 1ch;
    border-left: 2px solid var(--line-strong);
  }
  .head,
  .add {
    display: flex;
    gap: 0.5ch;
  }
  .name {
    flex: 1;
    min-width: 0;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 1ch;
    flex-wrap: wrap;
  }
  .line select {
    flex: 1;
    min-width: 0;
  }
  .changed {
    color: var(--warn);
  }
  p {
    margin: 0;
  }
</style>
