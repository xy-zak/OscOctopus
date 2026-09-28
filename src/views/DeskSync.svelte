<script lang="ts">
  // DESK › SYNC: share this desk live with the devices of the sync session, see who else is
  // on it, choose whether this device forwards received OSC input for it, and restore an
  // earlier version.
  import { sync as syncIpc } from '../lib/ipc/commands';
  import type { Backup } from '../lib/ipc/types';
  import { presetStore } from '../lib/state/preset.svelte';
  import { showGlobal } from '../lib/state/ui.svelte';
  import { sharedDesks } from '../lib/sync/app.svelte';
  import { forwardingClashes, viewersOf } from '../lib/sync/locks';
  import { syncSession } from '../lib/sync/session.svelte';
  import { colorVars } from '../lib/theme/palettes';
  import Icon from '../lib/ui/Icon.svelte';
  import Lockable from '../lib/ui/Lockable.svelte';
  import Panel from '../lib/ui/Panel.svelte';
  import Toggle from '../lib/ui/Toggle.svelte';
  import { errorText } from '../lib/util';
  import { runAction } from './actions';
  import { duplicateDesk } from './deskActions';

  const desk = $derived(presetStore.current);
  const view = $derived(sharedDesks.view[desk.id]);
  const shared = $derived(view?.shared ?? false);
  const live = $derived(shared && syncSession.joined);
  const forwarding = $derived(sharedDesks.forwarding.includes(desk.id));
  const viewers = $derived(viewersOf(syncSession.presence, desk.id));
  const clash = $derived(
    live && forwardingClashes(syncSession.presence, sharedDesks.forwarding).includes(desk.id),
  );
  const forwarders = $derived(
    Object.entries(syncSession.presence)
      .filter(([, p]) => p.forwarding.includes(desk.id))
      .map(([peer]) => syncSession.peerName(peer)),
  );

  let backups: Backup[] = $state([]);
  let backupError: string | null = $state(null);
  $effect(() => {
    const id = desk.id;
    backups = [];
    backupError = null;
    if (!shared) return;
    syncIpc.backups(id).then(
      (list) => (backups = list),
      (e: unknown) => (backupError = errorText(e)),
    );
  });

  const restore = (b: Backup) => runAction('Restore', () => presetStore.importFile(b.path));
</script>

<div class="desk-sync scroll">
  <Lockable>
    <Panel title="Share with the session" active={live} tone="var(--scope)">
      {#snippet actions()}
        {#if live}<span class="pill ready">shared</span>{:else if shared}<span class="pill disabled"
            >not syncing</span
          >{/if}
      {/snippet}
      {#if !shared}
        <p>
          Share this desk with the devices in your sync session: everyone can play it and edit it at
          the same time. Only the device you touch sends OSC; the others show the value.
        </p>
        <div class="actions">
          <button
            class="btn primary"
            disabled={!syncSession.peerId}
            onclick={() => runAction('Share', () => sharedDesks.share(desk.id))}
            ><Icon name="share" /> Share with session</button
          >
          {#if !syncSession.joined}
            <button class="btn ghost" onclick={() => showGlobal('sync')}
              >Join a session first (GLOBAL SETTINGS › SYNC)</button
            >
          {/if}
        </div>
      {:else}
        {#if !syncSession.joined}
          <p class="warn-text">
            <Icon name="warning" /> No session joined: edits made here are kept and merge when you join
            again.
          </p>
        {/if}
        <div class="actions">
          <button class="btn" onclick={duplicateDesk}
            ><Icon name="copy" /> Make an independent copy</button
          >
          <button
            class="btn danger"
            onclick={() => runAction('Stop sharing', () => sharedDesks.unshare(desk.id))}
            >Stop sharing</button
          >
        </div>
        <p class="faint">
          Stopping keeps its history: sharing it again merges with the others like a reconnect. A
          copy is a new, unshared desk.
        </p>
      {/if}
    </Panel>

    {#if shared}
      <Panel title="On this desk">
        <div class="row">
          <span class="label">Devices here</span>
          <span>
            {#each viewers as peer (peer)}
              <span class="peer" style:color={colorVars(syncSession.peers[peer]?.color ?? 0).c}
                >● {syncSession.peerName(peer)}</span
              >
            {:else}
              <span class="faint">only you</span>
            {/each}
          </span>
        </div>
        <label class="row check">
          <Toggle checked={forwarding} onchange={(on) => sharedDesks.setForwarding(desk.id, on)} />
          Forward received OSC input from this device
        </label>
        <p class="faint">
          On a shared desk only one device should forward input (messages with FORWARD on), or
          device feedback is sent once per device.{forwarders.length
            ? ` Forwarding now: ${forwarders.join(', ')}${forwarding ? ' and this device' : ''}.`
            : ''}
        </p>
        {#if clash}
          <p class="warn-text">
            <Icon name="warning" /> More than one device forwards input for this desk.
          </p>
        {/if}
      </Panel>

      <Panel title="Earlier versions">
        {#if backups.length}
          <p class="faint">
            Kept on this device before changes were saved, so a bad edit from anyone can be undone.
          </p>
          <ul class="list">
            {#each backups as b (b.path)}
              <li>
                <span>{new Date(b.savedAtMs).toLocaleString()}</span>
                <button class="btn ghost" onclick={() => restore(b)}>Restore as copy</button>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="faint">
            None yet. A copy of the desk is kept at most every 5 minutes while it changes (the last
            10).
          </p>
        {/if}
        {#if backupError}<p class="faint">{backupError}</p>{/if}
      </Panel>
    {/if}
  </Lockable>
</div>

<style>
  .desk-sync {
    height: 100%;
    padding: 16px 2ch 32px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-width: 110ch;
    margin: 0 auto;
  }
  p {
    margin: 0;
  }
  .actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 1ch;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 1ch;
  }
  .label {
    color: var(--fg-dim);
    text-transform: uppercase;
  }
  .peer {
    margin-right: 1ch;
  }
  .check {
    color: var(--fg-dim);
  }
  .warn-text {
    color: var(--warn);
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .list li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid var(--line);
  }
</style>
