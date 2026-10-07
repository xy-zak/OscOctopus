<script lang="ts">
  // Everything Rust knows about one endpoint: state, addresses, detail/error, and counters.
  import type { EndpointStatus } from '../../lib/ipc/types';
  import { formatBytes } from '../../lib/osc/format';
  import type { Rates } from '../../lib/state/network.svelte';
  import { toneOf } from '../../lib/ui/status';

  let { status, rates }: { status: EndpointStatus | undefined; rates: Rates | undefined } =
    $props();
</script>

{#if status}
  <div class="status">
    <div class="line">
      <span class="pill {toneOf(status.state)}">{status.state}</span>
      {#if status.local}<span class="mono">{status.local}</span>{/if}
      {#if status.remote}<span class="faint">→</span><span class="mono">{status.remote}</span>{/if}
    </div>
    {#if status.detail}
      <div class="detail mono" class:error={status.state === 'error'}>{status.detail}</div>
    {/if}
    <div class="stats mono faint">
      tx {status.stats.txPackets} pkt / {formatBytes(status.stats.txBytes)}
      · rx {status.stats.rxPackets} pkt / {formatBytes(status.stats.rxBytes)}
      · <span class:bad={status.stats.errors > 0}>{status.stats.errors} err</span>
      {#if rates}
        · {rates.txPps.toFixed(0)}↑ {rates.rxPps.toFixed(0)}↓ msg/s
      {/if}
    </div>
  </div>
{:else}
  <div class="status faint">Not applied yet</div>
{/if}

<style>
  .status {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 10px;
    background: var(--bg);
  }
  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .detail {
    color: var(--fg-dim);
    overflow-wrap: anywhere;
  }
  .detail.error {
    color: var(--danger);
  }
  .bad {
    color: var(--danger);
  }
</style>
