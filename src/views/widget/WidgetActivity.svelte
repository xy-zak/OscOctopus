<script lang="ts">
  // What actually happened on the wire for this widget, newest first, straight from the debug
  // log (so errors are the OS's own text), plus the throttle's counters. The panel around it
  // (a Collapsible) names it and links to TRAFFIC.
  import { formatTime, summarize } from '../../lib/osc/format';
  import { ACTIVITY_ROWS, debugStore } from '../../lib/state/debug.svelte';

  let { widgetId }: { widgetId: string } = $props();

  const recent = $derived(debugStore.recentFor(widgetId, ACTIVITY_ROWS).reverse());
  const stats = $derived(debugStore.throttle[widgetId]);
</script>

<section>
  {#if stats}
    <p class="mono muted stats">
      to core {stats.sent} · coalesced {stats.coalesced} ·
      <span class:bad={stats.failed > 0}>failed {stats.failed}</span>
    </p>
  {/if}
  {#each recent as e, i (i + ':' + e.seq + ':' + e.tsMicros)}
    <div class="event mono" class:bad={e.error}>
      <span class="faint">{formatTime(e.tsMicros).clock}</span>
      <span class="what"
        >{#if e.blocked}<span class="held">HELD</span>
        {/if}{e.error ?? summarize(e.decoded)}</span
      >
      <span class="faint where"
        >{e.endpointName || e.endpointId}{e.remote ? ` → ${e.remote}` : ''}</span
      >
      <span class="size faint">{e.wireLen ?? e.bytes.length} B</span>
    </div>
  {:else}
    <p class="faint">No packets from this widget yet.</p>
  {/each}
</section>

<style>
  section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .event {
    display: grid;
    grid-template-columns: auto 1fr auto;
    grid-template-areas:
      'time what size'
      'where where where';
    gap: 0 8px;
    padding: 5px 0;
    border-bottom: 1px solid color-mix(in srgb, var(--line) 60%, transparent);
  }
  .event > span:nth-child(1) {
    grid-area: time;
  }
  .what {
    grid-area: what;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .where {
    grid-area: where;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .size {
    grid-area: size;
  }
  .held {
    padding: 0 0.5ch;
    background: var(--danger);
    color: var(--bg);
    font-weight: 700;
  }
  .bad,
  .event.bad .what {
    color: var(--danger);
  }
  p {
    margin: 0;
  }
</style>
