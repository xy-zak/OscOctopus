<script lang="ts">
  // Edit-mode side panel for the selected widget, in four foldable sections:
  //   VISUAL       what every widget has (label, colour from its desk's palette, whether its
  //                title and value show, cell);
  //   INTERACTION  its type's own props (its <Type>Inspector, see widgets/registry.ts);
  //   MESSAGES     what it sends and receives, and a preview of exactly what it sends now
  //                (only what it receives, or no section, per `WidgetDef.messages`);
  //   ACTIVITY     what actually happened on the wire (folded by default).
  // Which sections are open is remembered per device once one is folded or unfolded.
  import type { Widget } from '../lib/model/preset';
  import { autoColorOn, pageKey, placesFor } from '../lib/model/subdesks';
  import { ACTIVITY_ROWS, debugStore } from '../lib/state/debug.svelte';
  import { lookStore } from '../lib/state/look.svelte';
  import { persistSetting } from '../lib/state/persist';
  import { presetStore } from '../lib/state/preset.svelte';
  import { showDesk, ui, type InspectorSection } from '../lib/state/ui.svelte';
  import { lockedBy, takeOver } from '../lib/sync/app.svelte';
  import { syncSession } from '../lib/sync/session.svelte';
  import { colorVars } from '../lib/theme/palettes';
  import Collapsible from '../lib/ui/Collapsible.svelte';
  import Field from '../lib/ui/Field.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import Swatches from '../lib/ui/Swatches.svelte';
  import Toggle from '../lib/ui/Toggle.svelte';
  import { plural } from '../lib/util';
  import { DEFS, messagesOf } from '../lib/widgets/defs';
  import { viewsOf } from '../lib/widgets/registry';
  import { removeWidget } from '../lib/widgets/subdesk/actions';
  import BindingsEditor from './inspector/BindingsEditor.svelte';
  import WidgetActivity from './widget/WidgetActivity.svelte';
  import WidgetHeader from './widget/WidgetHeader.svelte';
  import WidgetPreview from './widget/WidgetPreview.svelte';

  let { widget = $bindable() }: { widget: Widget } = $props();

  const touch = () => presetStore.touch();
  const Props = $derived(viewsOf(widget).inspector);
  // Soft lock (shared desks): read-only while another device edits this widget.
  const deskId = $derived(presetStore.current.id);
  const holders = $derived(lockedBy(deskId, widget.id));
  const locked = $derived(holders.length > 0);

  const open = (s: InspectorSection) => ui.inspectorOpen[s];
  const toggle = (s: InspectorSection) => (on: boolean) => {
    ui.inspectorOpen[s] = on;
    void persistSetting('inspectorSections', { ...ui.inspectorOpen });
  };

  const readout = $derived(DEFS[widget.type].readout);
  const hidden = $derived(
    [!widget.show.title && 'title', readout && !widget.show.value && 'value'].filter(Boolean),
  );
  const lookSummary = $derived(
    `${widget.label ? `“${widget.label}”` : 'no label'}${hidden.length ? ` (${hidden.join(', ')} hidden)` : ''} · x${widget.x} y${widget.y} · ${widget.w}×${widget.h}`,
  );
  const messages = $derived(messagesOf(widget));
  const messagesSummary = $derived.by(() => {
    const b = widget.bindings;
    if (b.length === 0) return 'none';
    const inn = b.filter((x) => x.receive).length;
    if (messages === 'receive') return `${plural(b.length, 'message')} · ${inn} in`;
    const out = b.filter((x) => x.send).length;
    return `${plural(b.length, 'message')} · ${out} out · ${inn} in`;
  });
  // Where it can go: the desk, or any sub-desk page it fits on.
  const places = $derived(
    placesFor(presetStore.current, widget.id).map((p) => ({ ...p, key: pageKey(p.ref) })),
  );
  const placedOn = $derived(pageKey(presetStore.pageOf(widget.id)));

  const activitySummary = $derived(
    plural(debugStore.recentFor(widget.id, ACTIVITY_ROWS).length, 'recent packet'),
  );
</script>

<div class="inspector">
  <WidgetHeader kind={DEFS[widget.type].label.toUpperCase()} label={widget.label} id={widget.id}>
    {#snippet actions()}
      <fieldset class="plain" disabled={locked}>
        <button
          class="btn icon"
          title="Duplicate"
          onclick={() => presetStore.duplicateWidget(widget.id)}><Icon name="copy" /></button
        >
        <button class="btn icon danger" title="Delete" onclick={() => removeWidget(widget.id)}
          ><Icon name="trash" /></button
        >
      </fieldset>
    {/snippet}
  </WidgetHeader>

  {#if locked}
    <div class="held" role="status">
      <span
        >● {holders.map((p) => syncSession.peerName(p)).join(', ')}
        {holders.length > 1 ? 'are' : 'is'} editing this widget. Read-only here until you take over.</span
      >
      <button class="btn" onclick={() => takeOver(deskId, widget.id)}>Take over</button>
    </div>
  {/if}

  <Collapsible
    title="Visual"
    open={open('visual')}
    ontoggle={toggle('visual')}
    summary={lookSummary}
  >
    <fieldset class="plain" disabled={locked}>
      <section class="grid2">
        <Field label="Label" wide>
          <input class="input" bind:value={widget.label} oninput={touch} />
        </Field>
        <Field
          label="Colour · {lookStore.forDesk(deskId).palette.name}"
          hint="From this desk’s palette (DESK › LOOK). AUTO follows the desk’s colour (on a sub-desk page, the sub-desk’s if it has one)"
          group
          wide
        >
          <Swatches
            value={widget.color}
            extras={[
              {
                value: null,
                label: 'AUTO',
                title: 'AUTO: the desk’s colour, or its sub-desk’s',
                color: colorVars(autoColorOn(presetStore.current, presetStore.pageOf(widget.id))).c,
              },
            ]}
            onchange={(c) => {
              widget.color = c;
              touch();
            }}
          />
        </Field>
        <Field label="Show" hint="On the desk, in the frame’s border" group wide>
          <span class="shows">
            <label class="row"
              ><Toggle bind:checked={widget.show.title} onchange={touch} /> Title</label
            >
            {#if readout}
              <label class="row" title={readout}
                ><Toggle bind:checked={widget.show.value} onchange={touch} /> Value
                <span class="faint">({readout.toLowerCase()})</span></label
              >
            {/if}
          </span>
        </Field>
        <Field label="Cell" wide>
          <span class="readout">x{widget.x} y{widget.y} · {widget.w}×{widget.h}</span>
        </Field>
        {#if places.length > 1 || placedOn}
          <Field
            label="Place"
            hint="The desk, or a sub-desk page: it goes where it fits there (smaller if it must)"
            wide
          >
            <select
              class="input"
              value={placedOn}
              onchange={(e) => {
                const to = places.find((p) => p.key === e.currentTarget.value);
                if (to) presetStore.place(widget.id, to.ref);
              }}
            >
              {#each places as p (p.key)}<option value={p.key}>{p.name}</option>{/each}
            </select>
          </Field>
        {/if}
      </section>
    </fieldset>
  </Collapsible>

  <Collapsible
    title="Interaction"
    open={open('interaction')}
    ontoggle={toggle('interaction')}
    summary="how the {DEFS[widget.type].label.toLowerCase()} behaves"
  >
    <fieldset class="plain" disabled={locked}>
      <Props bind:widget onchange={touch} />
    </fieldset>
  </Collapsible>

  {#if messages !== 'none'}
    <Collapsible
      title="Messages"
      open={open('messages')}
      ontoggle={toggle('messages')}
      summary={messagesSummary}
    >
      <fieldset class="plain" disabled={locked}>
        <BindingsEditor bind:widget onchange={touch} />
      </fieldset>
      {#if messages === 'full'}<WidgetPreview {widget} />{/if}
    </Collapsible>
  {/if}

  <Collapsible
    title="Activity"
    open={open('activity')}
    ontoggle={toggle('activity')}
    summary={activitySummary}
  >
    {#snippet actions()}
      <button class="btn ghost" onclick={() => showDesk('traffic')}>Traffic</button>
    {/snippet}
    <WidgetActivity widgetId={widget.id} heading={false} />
  </Collapsible>
</div>

<style>
  .inspector {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  /* Groups what a soft lock disables, without adding a box. */
  .plain {
    display: contents;
    border: 0;
    margin: 0;
    padding: 0;
    min-width: 0;
  }
  .held {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1ch;
    padding: 4px 1ch;
    border: 1px solid var(--warn);
    color: var(--warn);
  }
  .readout {
    line-height: var(--control-h);
  }
  .shows {
    display: flex;
    flex-wrap: wrap;
    gap: 0 3ch;
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
