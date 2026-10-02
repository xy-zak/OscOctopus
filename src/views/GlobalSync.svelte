<script lang="ts">
  // GLOBAL SETTINGS › SYNC: share desks live with other OscOctopus apps on the network. There
  // is no server. Every app in a session connects to the others: devices on the same LAN
  // find each other automatically, and others are added by address. Connections are
  // encrypted and only admit devices that know the session key.
  import type { PeerState, PeerStatus } from '../lib/ipc/types';
  import { presetStore } from '../lib/state/preset.svelte';
  import { showDesk } from '../lib/state/ui.svelte';
  import { sharedDesks } from '../lib/sync/app.svelte';
  import { missingLinks } from '../lib/sync/locks';
  import { syncSession } from '../lib/sync/session.svelte';
  import { colorVars } from '../lib/theme/palettes';
  import Field from '../lib/ui/Field.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import Lockable from '../lib/ui/Lockable.svelte';
  import NumberInput from '../lib/ui/NumberInput.svelte';
  import Panel from '../lib/ui/Panel.svelte';
  import Swatches from '../lib/ui/Swatches.svelte';
  import Toggle from '../lib/ui/Toggle.svelte';
  import { toast } from '../lib/state/ui.svelte';
  import { errorText } from '../lib/util';

  const s = $derived(syncSession.status);
  const profile = $derived(s?.local.profile);

  // ---- this device ---------------------------------------------------------------------------
  let name = $state('');
  let editingName = $state(false);
  $effect(() => {
    if (!editingName) name = profile?.name ?? '';
  });
  function commitName() {
    editingName = false;
    if (profile && name.trim() && name.trim() !== profile.name) void syncSession.setName(name);
  }

  // ---- session -------------------------------------------------------------------------------
  let sessionName = $state('');
  let secret = $state('');
  let remember = $state(true);
  /** The key was generated here: show it (after joining too) so others can type it in. */
  let generatedKey: string | null = $state(null);
  $effect(() => {
    if (!sessionName && syncSession.remembered) sessionName = syncSession.remembered;
  });
  const canRejoin = $derived(
    !!syncSession.remembered &&
      sessionName.trim().toLowerCase() === syncSession.remembered.toLowerCase(),
  );
  const weak = $derived(!generatedKey && secret.trim().length > 0 && secret.trim().length < 12);
  const canJoin = $derived(
    !syncSession.busy && sessionName.trim().length > 0 && (secret.trim().length >= 8 || canRejoin),
  );

  async function generate() {
    generatedKey = await syncSession.newKey();
    secret = generatedKey;
  }
  async function join() {
    await syncSession.join(sessionName, secret.trim() || null, remember);
    if (!syncSession.error && secret !== generatedKey) secret = '';
  }
  async function copyKey() {
    if (!generatedKey) return;
    try {
      await navigator.clipboard.writeText(generatedKey);
      toast('Session key copied');
    } catch (e) {
      toast(`Could not copy: ${errorText(e)}`, 'error');
    }
  }

  // ---- connection ----------------------------------------------------------------------------
  let newPeer = $state('');
  const config = $derived(s?.config);
  async function addPeer() {
    if (!config || !newPeer.trim()) return;
    const ok = await syncSession.setConfig({
      ...config,
      manualPeers: [...config.manualPeers, newPeer.trim()],
    });
    if (ok) newPeer = '';
  }
  function removePeer(spec: string) {
    if (config)
      void syncSession.setConfig({
        ...config,
        manualPeers: config.manualPeers.filter((p) => p !== spec),
      });
  }

  // ---- peers ---------------------------------------------------------------------------------
  const PILL: Record<PeerState, string> = {
    connected: 'ready',
    connecting: 'connecting',
    retrying: 'starting',
    refused: 'error',
  };
  const connectedCount = $derived(s?.peers.filter((p) => p.state === 'connected').length ?? 0);
  const ms = (v: number | null) => (v === null ? '—' : `${Math.round(v)} ms`);
  function offset(p: PeerStatus) {
    if (p.clockOffsetMs === null) return '—';
    const sec = p.clockOffsetMs / 1000;
    return Math.abs(sec) < 1 ? 'in step' : `${sec > 0 ? '+' : ''}${sec.toFixed(1)} s`;
  }

  // ---- shared desks in the session -----------------------------------------------------------
  /** Each desk peers share, once, with who shares it. */
  const sessionDesks = $derived.by(() => {
    const byKey = new Map<string, { id: string; doc: string; name: string; peers: string[] }>();
    for (const [peer, desks] of Object.entries(sharedDesks.available)) {
      for (const d of desks) {
        const key = `${d.id}/${d.doc}`;
        const row = byKey.get(key) ?? { ...d, peers: [] };
        row.peers.push(peer);
        byKey.set(key, row);
      }
    }
    return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
  });
  const openHere = (id: string) => presetStore.isOpen(id) && sharedDesks.view[id]?.shared;
  function goTo(id: string) {
    presetStore.activate(id);
    showDesk('controls');
  }
  const links = $derived(missingLinks(syncSession.presence, Object.keys(syncSession.peers)));
</script>

<div class="sync scroll">
  <Panel title="This device">
    {#if s}
      <div class="grid">
        <Field label="Name (shown to others)">
          <input
            class="input"
            maxlength="40"
            bind:value={name}
            onfocus={() => (editingName = true)}
            onblur={commitName}
            onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          />
        </Field>
        <Field label="Fingerprint" hint="Compare it by eye to know a device is really this one">
          <span class="readout">{s.local.fingerprint}</span>
        </Field>
        <Field
          label="Colour (shown to others)"
          hint="Each of them sees it in their own palette"
          group
          wide
        >
          <Swatches value={syncSession.color} onchange={(c) => syncSession.setColor(c)} />
        </Field>
      </div>
      {#if s.local.identityError}
        <p class="error-text">
          <Icon name="warning" /> The saved device identity could not be read ({s.local
            .identityError}). A temporary one is used until it is fixed.
        </p>
      {/if}
    {:else}
      <p class="faint">Starting…</p>
    {/if}
  </Panel>

  <Lockable>
    <Panel title="Session" active={syncSession.joined}>
      {#snippet actions()}
        {#if syncSession.joined}<span class="pill ready">joined</span>{/if}
      {/snippet}
      {#if s?.session}
        <div class="grid">
          <Field label="Session">
            <span class="readout strong">{s.session}</span>
          </Field>
          <Field label="Devices connected">
            <span class="readout">{connectedCount}</span>
          </Field>
          {#if generatedKey}
            <Field label="Session key" hint="Everyone joining types this in" wide>
              <span class="key-row">
                <span class="key">{generatedKey}</span>
                <button class="btn ghost" onclick={copyKey}><Icon name="copy" /> Copy</button>
              </span>
            </Field>
          {/if}
        </div>
        <div class="actions">
          <button class="btn danger" disabled={syncSession.busy} onclick={() => syncSession.leave()}
            ><Icon name="signout" /> Leave session</button
          >
          {#if syncSession.remembered}
            <label class="check">
              <Toggle
                checked={syncSession.autoJoin}
                onchange={(on) => syncSession.setAutoJoin(on)}
              />
              Join this session when the app starts
            </label>
          {/if}
        </div>
      {:else}
        <div class="grid">
          <Field label="Session name" hint="The same on every device, e.g. the show's name">
            <input class="input" maxlength="64" bind:value={sessionName} placeholder="Stage" />
          </Field>
          <Field
            label="Session key"
            hint={canRejoin && !secret
              ? 'Leave empty to use the key remembered on this device'
              : 'Generate one here and type it on the other devices, or use a passphrase'}
          >
            <span class="key-row">
              <input
                class="input"
                class:invalid={weak}
                bind:value={secret}
                oninput={() => (generatedKey = secret === generatedKey ? generatedKey : null)}
                placeholder={canRejoin ? '(remembered)' : 'XXXX-XXXX-…'}
                autocomplete="off"
                spellcheck="false"
              />
              <button class="btn" onclick={generate}><Icon name="key" /> Generate</button>
            </span>
          </Field>
        </div>
        {#if weak}
          <p class="warn-text">
            <Icon name="warning" /> A short passphrase can be guessed. Generate a key, or use a long phrase.
          </p>
        {/if}
        <div class="actions">
          <button class="btn primary" disabled={!canJoin} onclick={join}
            ><Icon name="signin" /> Join</button
          >
          <label class="check">
            <Toggle bind:checked={remember} />
            Remember the key on this device
          </label>
          {#if syncSession.remembered}
            <button class="btn ghost" onclick={() => syncSession.forget()}
              >Forget “{syncSession.remembered}”</button
            >
          {/if}
        </div>
      {/if}
      {#if syncSession.error}
        <p class="error-text"><Icon name="warning" /> {syncSession.error}</p>
      {/if}
      <p class="faint">
        The key never leaves this device and is not stored: with Remember on, only a key derived
        from it is kept. Shared desks and live values reach only devices that know it.
      </p>
    </Panel>

    <Panel title="Shared in this session">
      {#if !syncSession.joined}
        <p class="faint">Join a session to see the desks others share.</p>
      {:else}
        <ul class="list">
          {#each sessionDesks as d (d.id + d.doc)}
            <li>
              <span>
                <span class="strong">{d.name}</span>
                <span class="faint">· {d.peers.map((p) => syncSession.peerName(p)).join(', ')}</span
                >
              </span>
              {#if openHere(d.id)}
                <button class="btn ghost" onclick={() => goTo(d.id)}>Show</button>
              {:else if sharedDesks.joining[d.id]}
                <span class="faint">opening…</span>
              {:else}
                <button
                  class="btn"
                  onclick={() => sharedDesks.open(d.peers[0]!, d)}
                  title="Open it here and edit it together"><Icon name="download" /> Open</button
                >
              {/if}
            </li>
          {:else}
            <li class="faint">No other device shares a desk yet (DESK › SYNC).</li>
          {/each}
        </ul>
        {#each links as [p, q] (p + q)}
          <p class="warn-text">
            <Icon name="warning" />
            {syncSession.peerName(p)} and {syncSession.peerName(q)} are not connected to each other. Their
            edits still meet through this device, within a few seconds.
          </p>
        {/each}
        {#each Object.entries(sharedDesks.clockSkew) as [peer, ms] (peer)}
          <p class="warn-text">
            <Icon name="warning" />
            {syncSession.peerName(peer)}'s clock is {Math.round(ms / 1000)} s ahead of this one: its edits
            are ignored until the clocks are set right.
          </p>
        {/each}
        {#each Object.keys(sharedDesks.unsettled) as peer (peer)}
          <p class="warn-text">
            <Icon name="warning" /> Desks keep differing from {syncSession.peerName(peer)}'s: update
            OscOctopus on both devices.
          </p>
        {/each}
      {/if}
    </Panel>

    <Panel title="Connection">
      {#if config && s}
        <div class="grid">
          <Field
            label="Listen port (TCP)"
            hint={s.listenError ??
              (s.listening ? `listening on ${s.listening}` : 'used once a session is joined')}
          >
            <NumberInput
              value={config.port}
              min={0}
              max={65535}
              integer
              onchange={(port) => void syncSession.setConfig({ ...config, port })}
            />
          </Field>
          <Field
            label="Find devices on the LAN"
            hint={s.discoveryError ??
              (s.discoveryActive ? 'discovery active (mDNS)' : 'devices must be added by address')}
          >
            <Toggle
              checked={config.discovery}
              onchange={(discovery) => void syncSession.setConfig({ ...config, discovery })}
            />
          </Field>
          <Field
            label="Devices by address"
            hint="host:port of another app (its listen port), for networks where discovery can't reach"
            wide
          >
            <span class="key-row">
              <input
                class="input"
                bind:value={newPeer}
                placeholder="192.168.1.30:9701"
                onkeydown={(e) => e.key === 'Enter' && addPeer()}
              />
              <button class="btn" disabled={!newPeer.trim()} onclick={addPeer}
                ><Icon name="plus" /> Add</button
              >
            </span>
          </Field>
        </div>
        {#if config.manualPeers.length}
          <ul class="list">
            {#each config.manualPeers as spec (spec)}
              <li>
                <span>{spec}</span>
                <button
                  class="btn icon ghost"
                  title="Stop connecting to {spec}"
                  onclick={() => removePeer(spec)}><Icon name="close" /></button
                >
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </Panel>
  </Lockable>

  <Panel title="Devices">
    {#snippet actions()}
      <span class="faint">{connectedCount} connected</span>
    {/snippet}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Device</th><th>State</th><th>Address</th><th>Round trip</th><th>Clock</th><th
              >Messages</th
            ><th></th>
          </tr>
        </thead>
        <tbody>
          {#each s?.peers ?? [] as p (p.peerId ?? p.address)}
            <tr>
              <td>
                {#if p.name}
                  <span class="dot" style:color={colorVars(p.color ?? 0).c}>●</span>
                  {p.name}
                {:else}
                  <span class="faint"
                    >{p.source === 'discovered' ? 'found on LAN' : 'by address'}</span
                  >
                {/if}
                {#if p.fingerprint}<span class="faint"> · {p.fingerprint}</span>{/if}
              </td>
              <td><span class="pill {PILL[p.state]}">{p.state}</span></td>
              <td class="faint">{p.address}</td>
              <td>{ms(p.rttMs)}</td>
              <td>{offset(p)}</td>
              <td class="faint">
                {#if p.state === 'connected'}
                  {p.stats.txMsgs}↑ {p.stats.rxMsgs}↓{p.stats.rejected
                    ? ` · ${p.stats.rejected} refused`
                    : ''}{p.stats.droppedValues ? ` · ${p.stats.droppedValues} values skipped` : ''}
                {/if}
              </td>
              <td>
                {#if p.peerId}
                  <button
                    class="btn ghost"
                    title="Refuse this device from now on"
                    onclick={() => p.peerId && syncSession.block(p.peerId)}
                    ><Icon name="ban" /> Block</button
                  >
                {/if}
              </td>
            </tr>
            {#if p.lastError && p.state !== 'connected'}
              <tr class="detail"><td></td><td colspan="6">{p.lastError}</td></tr>
            {/if}
          {:else}
            <tr>
              <td colspan="7" class="faint">
                {syncSession.joined
                  ? 'No other devices yet. They appear here as they join the session.'
                  : 'Join a session to connect to other devices.'}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if s?.blocked.length}
      <p class="faint">Blocked devices:</p>
      <ul class="list">
        {#each s.blocked as id (id)}
          <li>
            <span>{id.match(/.{1,4}/g)?.join('-')}</span>
            <button class="btn ghost" onclick={() => syncSession.unblock(id)}>Unblock</button>
          </li>
        {/each}
      </ul>
    {/if}
  </Panel>
</div>

<style>
  .sync {
    height: 100%;
    padding: 16px 2ch 32px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-width: 120ch;
    margin: 0 auto;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(28ch, 1fr));
    gap: 10px 2ch;
  }
  .actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 1ch 2ch;
    margin-top: 10px;
  }
  .readout {
    line-height: var(--control-h);
  }
  .strong {
    font-weight: 700;
  }
  .key-row {
    display: flex;
    gap: 1ch;
    align-items: center;
  }
  .key {
    font-weight: 700;
    letter-spacing: 0.05em;
    user-select: all;
  }
  .check {
    display: inline-flex;
    align-items: center;
    gap: 1ch;
    color: var(--fg-dim);
  }
  .list {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
  }
  .list li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1ch;
    padding: 2px 0;
    border-bottom: 1px solid var(--line);
  }
  .table-wrap {
    overflow-x: auto;
  }
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
  .detail td {
    color: var(--danger);
    white-space: normal;
  }
  .dot {
    margin-right: 0.5ch;
  }
  .error-text {
    color: var(--danger);
  }
  .warn-text {
    color: var(--warn);
  }
  p {
    margin: 8px 0 0;
  }
</style>
