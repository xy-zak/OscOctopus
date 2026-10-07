<script lang="ts">
  // GLOBAL SETTINGS › NETWORK: the device's own interfaces, and a read-only overview of every endpoint of
  // every open desk (they all run at once). Endpoints are edited inside each desk.
  import { formatBytes } from '../lib/osc/format';
  import { networkStore } from '../lib/state/network.svelte';
  import { presetStore } from '../lib/state/preset.svelte';
  import { showDesk } from '../lib/state/ui.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import Panel from '../lib/ui/Panel.svelte';
  import { toneOf } from '../lib/ui/status';

  const rows = $derived(
    presetStore.desks.flatMap((d) =>
      [
        ...d.network.outputs.map((o) => ({ kind: 'out', cfg: o })),
        ...d.network.inputs.map((i) => ({ kind: 'in', cfg: i })),
      ].map((r) => ({ desk: d, ...r, status: networkStore.status(d.id, r.cfg.id) })),
    ),
  );

  function openDeskNetwork(id: string) {
    presetStore.activate(id);
    showDesk('network');
  }
</script>

<div class="page scroll">
  <Panel
    title="All desk endpoints"
    hint="Every open desk's outputs and inputs. Click one to edit it in that desk's NETWORK section."
  >
    {#snippet actions()}
      {#if networkStore.paused}<span class="pill bad">output paused</span>{/if}
    {/snippet}
    <table>
      <thead>
        <tr>
          <th>Desk</th><th></th><th>Endpoint</th><th>State</th><th>Local → remote</th><th
            >Traffic</th
          >
        </tr>
      </thead>
      <tbody>
        {#each rows as r (r.desk.id + r.cfg.id)}
          {@const s = r.status}
          <tr
            class="clickable"
            onclick={() => openDeskNetwork(r.desk.id)}
            data-tip="Edit in {r.desk.name} › Network"
          >
            <td class="desk">{r.desk.name}</td>
            <td class="faint">{r.kind === 'out' ? '↑' : '↓'} {r.cfg.transport.toUpperCase()}</td>
            <td>{r.cfg.name}</td>
            <td><span class="pill {toneOf(s?.state)}">{s?.state ?? 'not applied'}</span></td>
            <td class="addr">{s?.local ?? '—'}{s?.remote ? ` → ${s.remote}` : ''}</td>
            <td class="faint">
              {#if s}{s.stats.txPackets}↑ {s.stats.rxPackets}↓{s.stats.blocked
                  ? ` ${s.stats.blocked} held`
                  : ''}{s.stats.errors ? ` ${s.stats.errors}✕` : ''} · {formatBytes(
                  s.stats.txBytes + s.stats.rxBytes,
                )}{/if}
            </td>
          </tr>
          {#if s?.state === 'error' && s.detail}
            <tr class="detail"><td></td><td colspan="5">{s.detail}</td></tr>
          {/if}
        {:else}
          <tr><td colspan="6" class="faint">No endpoints on any desk.</td></tr>
        {/each}
      </tbody>
    </table>
  </Panel>

  <Panel
    title="Interfaces on this device"
    hint="Use these addresses for “send from (bind)”, “listen on” and broadcast targets in a desk's NETWORK section."
  >
    {#snippet actions()}
      <button class="btn ghost" onclick={() => networkStore.refreshInterfaces()}
        ><Icon name="refresh" /> Refresh</button
      >
    {/snippet}
    <table>
      <thead><tr><th>Name</th><th>Address</th><th>Broadcast</th><th>State</th></tr></thead>
      <tbody>
        {#each networkStore.interfaces as i (i.name + i.ip)}
          <tr class:faint={!i.isUp}>
            <td>{i.name}</td>
            <td>{i.ip}/{i.prefixLen}</td>
            <td>{i.broadcast ?? '—'}</td>
            <td>{i.isUp ? 'up' : 'down'}{i.isLoopback ? ' · loopback' : ''}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </Panel>
</div>

<style>
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th {
    text-align: left;
    font-weight: 400;
    color: var(--fg-dim);
    text-transform: uppercase;
  }
  th,
  td {
    padding: 4px 1ch;
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
  }
  .clickable {
    cursor: pointer;
  }
  .clickable:hover td {
    background: var(--bg-3);
  }
  .desk {
    font-weight: 700;
    text-transform: uppercase;
  }
  .addr {
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 40ch;
  }
  .detail td {
    color: var(--danger);
    white-space: normal;
  }
</style>
