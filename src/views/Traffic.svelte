<script lang="ts">
  import Icon from '../lib/ui/Icon.svelte';
  import { save } from '@tauri-apps/plugin-dialog';
  import { debug as debugIpc } from '../lib/ipc/commands';
  import type { DebugEvent } from '../lib/ipc/types';
  import { formatArg, formatBytes, formatTime, hexDump, summarize } from '../lib/osc/format';
  import { debugStore } from '../lib/state/debug.svelte';
  import { networkStore } from '../lib/state/network.svelte';
  import { inputStore, type Outcome } from '../lib/state/input.svelte';
  import { presetStore } from '../lib/state/preset.svelte';
  import { toast } from '../lib/state/ui.svelte';
  import Segmented from '../lib/ui/Segmented.svelte';
  import Toggle from '../lib/ui/Toggle.svelte';
  import VirtualList from '../lib/ui/VirtualList.svelte';
  import { errorText } from '../lib/util';

  type Dir = 'all' | 'out' | 'in';
  type Kind = 'all' | 'packets' | 'lifecycle' | 'errors' | 'blocked';

  let dir: Dir = $state('all');
  let kind: Kind = $state('all');
  let endpoint = $state('');
  /**
   * Desk this log is scoped to (a desk's own TRAFFIC section), or undefined for GLOBAL
   * SETTINGS › TRAFFIC, which shows every desk plus app-wide events.
   */
  let { scope }: { scope?: string } = $props();
  let chosenDesk = $state('');
  const desk = $derived(scope ?? chosenDesk);
  // A different desk's endpoints don't apply: reset the endpoint filter when the scope moves.
  $effect(() => {
    void scope;
    endpoint = '';
  });
  let search = $state('');
  let follow = $state(true);
  // raw: events are plain objects from Rust; a deep proxy would break `===` row matching.
  let selected = $state.raw<DebugEvent | null>(null);

  // The debug log is app-wide: it holds every desk's events. Endpoint filters are desk-qualified,
  // because two desks may reuse the same endpoint id.
  const deskName = (id: string | null) =>
    id ? (presetStore.desks.find((d) => d.id === id)?.name ?? 'closed desk') : '';
  const endpoints = $derived(
    presetStore.desks
      .filter((d) => !desk || d.id === desk)
      .flatMap((d) => [
        ...d.network.outputs.map((o) => ({
          key: `${d.id}/${o.id}`,
          name: `${d.name} ↑ ${o.name}`,
        })),
        ...d.network.inputs.map((i) => ({ key: `${d.id}/${i.id}`, name: `${d.name} ↓ ${i.name}` })),
      ]),
  );

  const filtered = $derived.by(() => {
    const q = search.trim().toLowerCase();
    return debugStore.events.filter((e) => {
      if (dir !== 'all' && e.direction !== dir) return false;
      if (kind === 'packets' && e.kind !== 'packet') return false;
      if (kind === 'lifecycle' && e.kind === 'packet') return false;
      if (kind === 'errors' && !e.error && !e.decodeError) return false;
      if (kind === 'blocked' && !e.blocked) return false;
      if (desk && e.desk !== desk) return false;
      if (endpoint && `${e.desk}/${e.endpointId}` !== endpoint) return false;
      if (q) {
        const hay =
          `${summarize(e.decoded)} ${e.endpointName} ${e.remote ?? ''} ${e.error ?? ''} ${e.message ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  });

  function badge(e: DebugEvent): { text: string; cls: string } {
    if (e.blocked) return { text: 'HELD', cls: 'blocked' };
    if (e.kind === 'info') return { text: 'INFO', cls: 'info' };
    if (e.kind === 'error' || e.error)
      return { text: e.direction === 'out' ? 'OUT ✕' : 'ERR', cls: 'error' };
    return e.direction === 'out' ? { text: 'OUT →', cls: 'out' } : { text: '← IN', cls: 'in' };
  }

  function rowText(e: DebugEvent) {
    if (e.kind !== 'packet') return e.message ?? e.error ?? '';
    if (e.blocked) return `${summarize(e.decoded)} · paused, not sent`;
    const mapped = e.direction === 'in' ? inputNote(e) : '';
    if (e.decoded) return `${summarize(e.decoded)}${mapped ? ` · ${mapped}` : ''}`;
    return e.decodeError ? `undecodable: ${e.decodeError}` : '';
  }

  const RESULTS: Record<Outcome['result'], string> = {
    applied: '→',
    forwarded: '→ forwarded by',
    coalesced: 'superseded (newer value in the same batch) for',
    touched: 'not applied (being touched):',
    'own echo': 'own value echoed back, ignored by',
    ignored: 'not a usable value for',
    'no match': 'no widget listens to this',
    dropped: 'dropped (too many at once) for',
    'forward stopped': '→ (forwarding stopped: loop)',
  };

  /** What input mapping did with an inbound packet, in words. */
  function inputNote(e: DebugEvent): string {
    if (e.origin === 'self') return 'from this app: not applied to widgets';
    if (e.origin === 'peer') return 'from a sync peer app: not applied';
    const outcomes = inputStore.outcomeOf(e.seq);
    if (!outcomes) return '';
    return outcomes
      .map((o) => (o.widget ? `${RESULTS[o.result]} ${o.widget}` : RESULTS[o.result]))
      .join(' · ');
  }

  async function exportLog() {
    try {
      const path = await save({
        defaultPath: `osc-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (!path) return;
      const n = await debugIpc.exportTo(path);
      toast(`Exported ${n} events to ${path}`);
    } catch (e) {
      toast(`Export failed: ${errorText(e)}`, 'error');
    }
  }

  function copyJson(e: DebugEvent) {
    navigator.clipboard.writeText(JSON.stringify(e, null, 2)).then(
      () => toast('Event copied as JSON'),
      (err: unknown) => toast(`Copy failed: ${errorText(err)}`, 'error'),
    );
  }

  const totalRates = $derived(
    Object.values(networkStore.rates).reduce(
      (a, r) => ({ tx: a.tx + r.txPps, rx: a.rx + r.rxPps }),
      { tx: 0, rx: 0 },
    ),
  );
</script>

<div class="debug">
  <div class="toolbar">
    <button
      class="btn"
      class:primary={debugStore.paused}
      onclick={() => debugStore.setPaused(!debugStore.paused)}
    >
      {#if debugStore.paused}<Icon name="play" /> Resume{#if debugStore.heldCount}
          ({debugStore.heldCount} new){/if}{:else}<Icon name="pause" /> Pause{/if}
    </button>
    <button class="btn" onclick={() => ((selected = null), debugStore.clear())}
      ><Icon name="trash" /> Clear</button
    >
    <button class="btn" onclick={exportLog}><Icon name="download" /> Export</button>
    <Segmented
      size="sm"
      options={[
        { value: 'all', label: 'All' },
        { value: 'out', label: 'Out' },
        { value: 'in', label: 'In' },
      ]}
      bind:value={dir}
    />
    <select class="input narrow" bind:value={kind}>
      <option value="all">All events</option>
      <option value="packets">Packets only</option>
      <option value="lifecycle">Lifecycle only</option>
      <option value="errors">Errors only</option>
      <option value="blocked">Held (OSC-OUT off)</option>
    </select>
    {#if scope === undefined}
      <select class="input narrow" bind:value={chosenDesk} onchange={() => (endpoint = '')}>
        <option value="">All desks</option>
        {#each presetStore.desks as d (d.id)}<option value={d.id}>{d.name}</option>{/each}
      </select>
    {/if}
    <select class="input narrow" bind:value={endpoint}>
      <option value="">All endpoints</option>
      {#each endpoints as ep (ep.key)}<option value={ep.key}>{ep.name}</option>{/each}
    </select>
    <input class="input search" placeholder="Filter address / args / error…" bind:value={search} />
    <span class="follow"><Toggle bind:checked={follow} label="Follow newest" /> FOLLOW</span>
  </div>

  <div class="counters mono">
    <span>{filtered.length} shown / {debugStore.events.length} kept</span>
    <span>last seq {debugStore.lastSeq}</span>
    <span
      class:bad={debugStore.totalDropped > 0}
      title="Events Rust discarded because the UI could not keep up"
      >dropped {debugStore.totalDropped}</span
    >
    <span
      class:bad={debugStore.unexplainedGaps > 0}
      title="Sequence numbers missing without a reported drop (should always be 0)"
      >gaps {debugStore.unexplainedGaps}</span
    >
    <span>{totalRates.tx.toFixed(0)}↑ {totalRates.rx.toFixed(0)}↓ msg/s</span>
  </div>

  <div class="split">
    <div class="list">
      <VirtualList
        items={filtered}
        rowHeight={28}
        bind:follow
        key={(e, i) => (e.seq || -i) + ':' + e.tsMicros}
      >
        {#snippet row(e: DebugEvent)}
          {@const b = badge(e)}
          {@const t = formatTime(e.tsMicros)}
          <button class="row mono" class:sel={selected === e} onclick={() => (selected = e)}>
            <span class="time">{t.clock}<span class="faint">{t.micros}</span></span>
            <span class="badge {b.cls}">{b.text}</span>
            <span class="ep"
              >{#if scope === undefined && e.desk}<span class="faint">{deskName(e.desk)}/</span
                >{/if}{e.endpointName || e.endpointId || '—'}</span
            >
            <span class="remote faint">{e.remote ?? ''}</span>
            <span class="text" class:bad={e.error || e.decodeError}
              >{rowText(e)}{#if e.error && e.kind === 'packet'}
                — {e.error}{/if}</span
            >
            <span class="size faint"
              >{e.kind === 'packet' ? `${e.wireLen ?? e.bytes.length} B` : ''}</span
            >
          </button>
        {/snippet}
      </VirtualList>
    </div>

    {#if selected}
      {@const e = selected}
      <aside class="detail scroll">
        <div class="detail-head">
          <h2>Event #{e.seq || 'local'}</h2>
          <button class="btn ghost" onclick={() => copyJson(e)}>Copy JSON</button>
        </div>
        <dl class="mono">
          <dt>time</dt>
          <dd>{new Date(e.tsMicros / 1000).toISOString()} (+{formatTime(e.tsMicros).micros} µs)</dd>
          <dt>kind</dt>
          <dd>
            {e.kind}{e.direction ? ` · ${e.direction}` : ''}{e.transport ? ` · ${e.transport}` : ''}
          </dd>
          <dt>endpoint</dt>
          <dd>{e.endpointName} <span class="faint">{e.endpointId}</span></dd>
          {#if e.desk}<dt>desk</dt>
            <dd>{deskName(e.desk)} <span class="faint">{e.desk}</span></dd>{/if}
          {#if e.blocked}<dt>held</dt>
            <dd class="held">output was paused: these bytes were NOT sent</dd>{/if}
          {#if e.local}<dt>local</dt>
            <dd>{e.local}</dd>{/if}
          {#if e.remote}<dt>remote</dt>
            <dd>{e.remote}</dd>{/if}
          {#if e.kind === 'packet'}
            <dt>size</dt>
            <dd>
              {e.bytes.length} B OSC{e.wireLen !== null && e.wireLen !== e.bytes.length
                ? ` · ${e.wireLen} B on the wire (framed)`
                : e.wireLen === null
                  ? ' · wire size unknown (TCP stream)'
                  : ''}
            </dd>
          {/if}
          {#if e.source}<dt>widget</dt>
            <dd>
              {presetStore.findWidget(e.source)?.widget.label ?? 'removed widget'}
              <span class="faint">{e.source}</span>
            </dd>{/if}
          {#if e.message}<dt>note</dt>
            <dd>{e.message}</dd>{/if}
          {#if e.direction === 'in' && inputNote(e)}<dt>input</dt>
            <dd>{inputNote(e)}</dd>{/if}
          {#if e.error}<dt>error</dt>
            <dd class="bad">{e.error}</dd>{/if}
          {#if e.decodeError}<dt>decode</dt>
            <dd class="bad">{e.decodeError}</dd>{/if}
        </dl>

        {#if e.decoded?.kind === 'message'}
          <h2>Decoded</h2>
          <div class="decoded mono">
            <div>
              <span class="faint">address</span> <span class="addr">{e.decoded.address}</span>
            </div>
            <div>
              <span class="faint">typetags</span> <span class="tags">{e.decoded.typetags}</span>
            </div>
            {#each e.decoded.args as a, i (i)}
              <div>
                <span class="faint">[{i}]</span> <span class="tags">{a.type}</span>
                {formatArg(a)}
              </div>
            {/each}
          </div>
        {:else if e.decoded?.kind === 'bundle'}
          <h2>Decoded bundle</h2>
          <pre class="mono">{JSON.stringify(e.decoded, null, 2)}</pre>
        {/if}

        {#if e.bytes.length}
          <h2>Raw bytes</h2>
          <div class="hex mono">
            {#each hexDump(e.bytes, 8) as line (line.offset)}
              <div>
                <span class="faint">{line.offset}</span>
                {line.hex.padEnd(24)} <span class="ascii">{line.ascii}</span>
              </div>
            {/each}
          </div>
        {/if}
      </aside>
    {/if}
  </div>

  <div class="footer faint">
    Per-endpoint counters: {#each Object.entries(networkStore.statuses).filter(([, st]) => !scope || st.desk === scope) as [id, s] (id)}<span
        class="mono"
        >{deskName(s.desk)}/{s.name}: {s.stats.txPackets}↑ {s.stats.rxPackets}↓ {s.stats.errors}✕{s
          .stats.blocked
          ? ` ${s.stats.blocked} held`
          : ''}
        {formatBytes(s.stats.txBytes + s.stats.rxBytes)}</span
      >{/each}
  </div>
</div>

<style>
  .debug {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    padding: 8px 12px;
    border-bottom: 1px solid var(--line);
    background: var(--bg-2);
  }
  .narrow {
    width: auto;
  }
  .search {
    flex: 1;
    min-width: 160px;
  }
  .follow {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--fg-dim);
  }
  .counters {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    padding: 6px 12px;
    color: var(--fg-dim);
    border-bottom: 1px solid var(--line);
  }
  .bad {
    color: var(--danger) !important;
  }
  .split {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .list {
    flex: 1;
    min-width: 0;
    container-type: inline-size;
  }
  .row {
    width: 100%;
    height: 100%;
    display: grid;
    /* Every column takes a share of the width (the message the biggest), so the columns spread
       across the whole list instead of bunching up at the left. */
    grid-template-columns:
      minmax(15ch, 1.2fr) minmax(7ch, 0.8fr) minmax(10ch, 1.6fr) minmax(0, 1.6fr)
      minmax(0, 3fr) minmax(6ch, 0.6fr);
    gap: 2ch;
    align-items: center;
    padding: 0 12px;
    border: 0;
    border-bottom: 1px solid color-mix(in srgb, var(--line) 50%, transparent);
    background: none;
    text-align: left;
    white-space: nowrap;
  }
  .row > span {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .row:hover {
    background: var(--bg-2);
  }
  .row.sel {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  /* Columns drop out as the list narrows (e.g. when the detail pane opens); the message
     text is the last thing to go. */
  @container (max-width: 820px) {
    .row {
      grid-template-columns:
        minmax(15ch, 1.2fr) minmax(7ch, 0.8fr) minmax(10ch, 1.6fr) minmax(0, 3fr)
        minmax(6ch, 0.6fr);
      gap: 1.5ch;
    }
    .row .remote {
      display: none;
    }
  }
  @container (max-width: 560px) {
    .row {
      grid-template-columns: 12ch 7ch minmax(0, 1fr);
      gap: 1.5ch;
    }
    .row .ep,
    .row .size {
      display: none;
    }
    .time .faint {
      display: none;
    }
  }
  .badge {
    /* Keep the tag its own size when its column widens. */
    justify-self: start;
    min-width: 7ch;
    font-weight: 700;
    padding: 1px 6px;
    text-align: center;
  }
  .badge.out {
    color: var(--accent-text);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  .badge.in {
    color: var(--info);
    background: color-mix(in srgb, var(--info) 14%, transparent);
  }
  .badge.blocked {
    color: var(--bg);
    background: var(--warn);
  }
  .held {
    color: var(--warn);
  }
  .badge.info {
    color: var(--fg-dim);
    background: var(--bg-3);
  }
  .badge.error {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 14%, transparent);
  }
  .size {
    text-align: right;
  }
  .detail {
    width: 50ch;
    flex: none;
    padding: 14px;
    border-left: 1px solid var(--line);
    background: var(--bg-2);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  @media (max-width: 760px) {
    .split {
      flex-direction: column;
    }
    .detail {
      width: 100%;
      height: 50%;
      border-left: 0;
      border-top: 1px solid var(--line);
    }
  }
  .detail-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 12px;
    margin: 0;
  }
  dt {
    color: var(--fg-faint);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .decoded,
  .hex,
  pre {
    padding: 10px;
    background: var(--bg);
    margin: 0;
  }
  .hex {
    white-space: pre;
    overflow-x: auto;
  }
  .ascii {
    color: var(--warn);
  }
  .addr {
    color: var(--accent-text);
  }
  .tags {
    color: var(--info);
  }
  .footer {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    padding: 6px 12px;
    border-top: 1px solid var(--line);
  }
</style>
