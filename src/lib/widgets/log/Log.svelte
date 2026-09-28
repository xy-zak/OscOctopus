<script lang="ts">
  // The messages the followed widgets sent and received, newest first, in the columns chosen
  // (rows.ts). It reads this device's own records: sends by the widget that caused them (as
  // TRAFFIC does), receives by the widget input mapping gave them to. A long log scrolls.
  import { LOG_COLUMNS, type LogColumn, type LogWidget } from '../../model/preset';
  import { formatTime } from '../../osc/format';
  import { flag } from '../../skins/anatomy';
  import { debugStore } from '../../state/debug.svelte';
  import { inputStore } from '../../state/input.svelte';
  import { presetStore } from '../../state/preset.svelte';
  import WidgetFrame from '../WidgetFrame.svelte';
  import { COLUMNS, newestRows, receivedRow, sentRow, type LogRow } from './rows';

  let { widget, live }: { widget: LogWidget; live: boolean } = $props();

  const DIR: Record<LogRow['dir'], string> = { out: '→', in: '←', note: '•' };

  const p = $derived(widget.props);
  const desk = $derived(presetStore.findWidget(widget.id)?.desk);
  const followed = $derived(
    p.follow === 'desk'
      ? (desk?.widgets ?? []).filter((w) => w.id !== widget.id).map((w) => w.id)
      : p.sources,
  );
  const names = $derived(new Map((desk?.widgets ?? []).map((w) => [w.id, w.label || w.id])));

  /** An endpoint of the desk by id: an input, or an output whose replies came in. */
  function endpointName(id: string): string {
    const output = desk?.network.outputs.find((o) => o.id === id);
    if (output) return `↩ ${output.name}`;
    return desk?.network.inputs.find((i) => i.id === id)?.name ?? id;
  }

  const rows = $derived(
    newestRows(
      followed.flatMap((id) => [
        ...debugStore.recentFor(id).map((e) => sentRow(e, id)),
        ...inputStore.receivedFor(id).map((r) => receivedRow(r, endpointName(r.msg.endpointId))),
      ]),
      p.rows,
    ),
  );
  const columns = $derived(LOG_COLUMNS.filter((c) => p.columns.includes(c)));
  const template = $derived(columns.map((c) => COLUMNS[c].width).join(' '));

  function cell(r: LogRow, c: LogColumn): string {
    if (c === 'time') return formatTime(r.tsMicros).clock;
    if (c === 'dir') return DIR[r.dir];
    if (c === 'widget') return names.get(r.widgetId) ?? r.widgetId;
    return r[c];
  }
</script>

<WidgetFrame
  {widget}
  {live}
  status="{rows.length}/{p.rows}"
  role="log"
  aria-label={widget.label || 'Log'}
>
  {#snippet children()}
    <div class="log" style:--cols={template}>
      {#if columns.length}
        <div class="line" data-part="log.head">
          {#each columns as c (c)}<span class="cell" data-part="log.cell" data-col={c}
              >{COLUMNS[c].label}</span
            >{/each}
        </div>
      {/if}
      <div class="rows" data-part="log.rows">
        {#each rows as r (r.key)}
          <div
            class="line"
            data-part="log.row"
            data-in={flag(r.dir === 'in')}
            data-out={flag(r.dir === 'out')}
            data-error={flag(r.error)}
            data-blocked={flag(r.blocked)}
          >
            {#each columns as c (c)}<span class="cell" data-part="log.cell" data-col={c}
                >{cell(r, c)}</span
              >{/each}
          </div>
        {:else}
          <span class="empty" data-part="log.empty">nothing yet</span>
        {/each}
      </div>
    </div>
  {/snippet}
</WidgetFrame>

<style>
  .log {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
  }
  .line {
    flex: none;
    display: grid;
    grid-template-columns: var(--cols);
    gap: 0 1ch;
    height: var(--log-row-h, var(--lh));
    padding: 0 0.5ch;
  }
  .rows {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    overflow-x: hidden;
    touch-action: pan-y;
    scrollbar-width: thin;
  }
  .cell {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .empty {
    padding: 0 0.5ch;
  }
</style>
