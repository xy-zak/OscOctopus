<script lang="ts">
  // Live-mode side panel: a read-only view of the widget touched last, in the Inspector's
  // format (the same header and foldable sections):
  //   VALUE     its live value right now;
  //   MESSAGES  exactly what it sends at that value, and where (for widgets whose messages send);
  //   ACTIVITY  what actually happened on the wire.
  // No editing here (the pencil opens it in EDIT). Which sections are open is remembered per
  // device once one is folded or unfolded (`ui.infoSections`).
  import type { Widget } from '../../lib/model/preset';
  import { colorOf } from '../../lib/model/subdesks';
  import { formatValue } from '../../lib/osc/format';
  import { rearmForward } from '../../lib/osc/receiver.svelte';
  import { ACTIVITY_ROWS, debugStore } from '../../lib/state/debug.svelte';
  import { inputStore } from '../../lib/state/input.svelte';
  import { persistSetting } from '../../lib/state/persist';
  import { presetStore } from '../../lib/state/preset.svelte';
  import { showDesk, ui, type InfoSection } from '../../lib/state/ui.svelte';
  import { values } from '../../lib/state/values.svelte';
  import { colorVars } from '../../lib/theme/palettes';
  import Collapsible from '../../lib/ui/Collapsible.svelte';
  import Icon from '../../lib/ui/Icon.svelte';
  import { plural } from '../../lib/util';
  import { DEFS, defOf, initialValue, messagesOf } from '../../lib/widgets/defs';
  import WidgetActivity from './WidgetActivity.svelte';
  import WidgetHeader from './WidgetHeader.svelte';
  import WidgetPreview from './WidgetPreview.svelte';

  let { widget }: { widget: Widget | undefined } = $props();

  function edit(w: Widget) {
    ui.mode = 'edit';
    presetStore.reveal(w.id);
  }

  const toggle = (s: InfoSection) => (on: boolean) => {
    ui.infoSections[s] = on;
    void persistSetting('infoSections', { ...ui.infoSections });
  };

  const value = $derived.by(() => {
    if (!widget) return '';
    const v = values[widget.id] ?? initialValue(widget);
    return defOf(widget).valueText?.(widget, v) ?? formatValue(v);
  });
  const messagesSummary = $derived.by(() => {
    if (!widget) return '';
    const out = widget.bindings.filter((b) => b.send && b.outputIds.length > 0).length;
    return out ? `${plural(out, 'message')} sent` : 'nothing sent';
  });
  const activitySummary = $derived(
    widget ? plural(debugStore.recentFor(widget.id, ACTIVITY_ROWS).length, 'recent packet') : '',
  );
</script>

<div class="info">
  <WidgetHeader
    kind={widget ? DEFS[widget.type].label.toUpperCase() : 'INFO'}
    label={widget?.label}
    id={widget?.id}
  >
    {#snippet actions()}
      {#if widget && !ui.locked}
        <button class="btn icon ghost" title="Edit this widget" onclick={() => edit(widget)}
          ><Icon name="pencil" /></button
        >
      {/if}
      <button class="btn icon ghost" title="Hide panel" onclick={() => (ui.infoOpen = false)}
        ><Icon name="close" /></button
      >
    {/snippet}
  </WidgetHeader>

  {#if widget}
    {@const found = presetStore.findWidget(widget.id)}
    {@const c = colorVars(found ? colorOf(found.desk, widget) : widget.color)}
    <Collapsible
      title="Value"
      open={ui.infoSections.value}
      ontoggle={toggle('value')}
      summary={value}
    >
      <div class="value" style:--c={c.c}>
        <span class="faint">&gt;</span>
        {value}<span class="cursor">█</span>
      </div>
      {#if inputStore.tripped[widget.id]}
        <p class="tripped">
          <span class="bad">Forwarding stopped: received values kept coming back (a loop?).</span>
          <button class="btn ghost" onclick={() => rearmForward(widget.id)}>Re-arm</button>
        </p>
      {/if}
    </Collapsible>

    {#if messagesOf(widget) === 'full'}
      <Collapsible
        title="Messages"
        open={ui.infoSections.messages}
        ontoggle={toggle('messages')}
        summary={messagesSummary}
      >
        <WidgetPreview {widget} />
      </Collapsible>
    {/if}

    <Collapsible
      title="Activity"
      open={ui.infoSections.activity}
      ontoggle={toggle('activity')}
      summary={activitySummary}
    >
      {#snippet actions()}
        <button class="btn ghost" onclick={() => showDesk('traffic')}>Traffic</button>
      {/snippet}
      <WidgetActivity widgetId={widget.id} heading={false} />
    </Collapsible>
  {:else}
    <p class="faint">Touch a widget to see the messages it sends and what happened on the wire.</p>
  {/if}
</div>

<style>
  .info {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .tripped {
    display: flex;
    align-items: center;
    gap: 1ch;
  }
  .bad {
    color: var(--danger);
  }
  /* A prompt line showing the live value. */
  .value {
    --c-text: var(--c);
    padding: 4px 1ch;
    border: 1px solid var(--c);
    background: var(--bg);
    color: var(--c-text);
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
  }
  :global(:root[data-mode='light']) .value {
    --c-text: color-mix(in srgb, var(--c) 50%, #000);
  }
  .cursor {
    margin-left: 0.5ch;
    animation: blink 1s steps(1) infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0;
    }
  }
  p {
    margin: 0;
  }
</style>
