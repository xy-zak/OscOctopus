<script lang="ts">
  // Edit-mode side panel for the selected widget: what every widget has (label, colour, cell),
  // its type's own props (its <Type>Inspector, see widgets/registry.ts), its messages, and a
  // live preview of exactly what it sends.
  import type { Widget } from '../lib/model/preset';
  import { appearance } from '../lib/state/appearance.svelte';
  import { presetStore } from '../lib/state/preset.svelte';
  import { PALETTES } from '../lib/theme/palettes';
  import Field from '../lib/ui/Field.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import Swatches from '../lib/ui/Swatches.svelte';
  import { DEFS } from '../lib/widgets/defs';
  import { viewsOf } from '../lib/widgets/registry';
  import BindingsEditor from './inspector/BindingsEditor.svelte';
  import WidgetActivity from './widget/WidgetActivity.svelte';
  import WidgetPreview from './widget/WidgetPreview.svelte';

  let { widget = $bindable() }: { widget: Widget } = $props();

  const touch = () => presetStore.touch();
  const Props = $derived(viewsOf(widget).inspector);
</script>

<div class="inspector">
  <header>
    <div class="head">
      <span class="kind">{DEFS[widget.type].label.toUpperCase()}</span>
      <span class="faint">{widget.id}</span>
    </div>
    <div class="actions">
      <button
        class="btn icon"
        title="Duplicate"
        onclick={() => presetStore.duplicateWidget(widget.id)}><Icon name="copy" /></button
      >
      <button
        class="btn icon danger"
        title="Delete"
        onclick={() => presetStore.removeWidget(widget.id)}><Icon name="trash" /></button
      >
    </div>
  </header>

  <section class="grid2">
    <Field label="Label" wide>
      <input class="input" bind:value={widget.label} oninput={touch} />
    </Field>
    <Field label="Colour · {PALETTES[appearance.theme.palette].name}" wide>
      <Swatches
        value={widget.color}
        onchange={(c) => {
          widget.color = c;
          touch();
        }}
      />
    </Field>
    <Field label="Cell" wide>
      <span class="readout">x{widget.x} y{widget.y} · {widget.w}×{widget.h}</span>
    </Field>
  </section>

  <Props bind:widget onchange={touch} />
  <BindingsEditor bind:widget onchange={touch} />
  <WidgetPreview {widget} />
  <WidgetActivity widgetId={widget.id} />
</div>

<style>
  .inspector {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .head {
    display: flex;
    gap: 1ch;
    min-width: 0;
  }
  .kind {
    padding: 0 1ch;
    background: var(--accent);
    color: var(--accent-ink);
    font-weight: 700;
  }
  .actions {
    display: flex;
    gap: 6px;
  }
  .readout {
    line-height: var(--control-h);
  }
  /* Layout vocabulary shared by every section of the panel, including each widget type's
     own inspector (widgets/<type>/<Type>Inspector.svelte). :where() keeps the element rules
     weaker than a component's own (e.g. WidgetPreview's section spacing). */
  .inspector :global(:where(section)) {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .inspector :global(.grid2) {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .inspector :global(.row) {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .inspector :global(.wide-note) {
    grid-column: 1 / -1;
  }
  .inspector :global(.axis-label) {
    color: var(--fg-dim);
  }
  .inspector :global(:where(p)) {
    margin: 0;
  }
</style>
