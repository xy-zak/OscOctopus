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

<div class="page scroll">
  <Lockable>
    <Panel
      title="Share with the session"
      hint="Everyone in your sync session can play a shared desk and edit it at the same time. Only the device you touch sends OSC; the others show the value."
      active={live}
    >
      {#snippet actions()}
        {#if live}<span class="pill ok">shared</span>{:else if shared}<span class="pill off"
            >not syncing</span
          >{/if}
      {/snippet}
      {#if !shared}
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
            No session joined: edits made here are kept and merge when you join again.
          </p>
        {/if}
        <div class="actions">
          <button class="btn" data-tip="A copy is a new desk, not shared" onclick={duplicateDesk}
            ><Icon name="copy" /> Make an independent copy</button
          >
          <button
            class="btn danger"
            data-tip="It keeps its history: sharing it again merges with the others like a reconnect"
            onclick={() => runAction('Stop sharing', () => sharedDesks.unshare(desk.id))}
            >Stop sharing</button
          >
        </div>
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
          <span
            class="has-tip"
            data-tip="On a shared desk only one device should forward input (messages with FORWARD on), or device feedback is sent once per device."
            >Forward received OSC input from this device</span
          >
        </label>
        {#if forwarders.length}
          <p class="faint">
            Forwarding now: {forwarders.join(', ')}{forwarding ? ' and this device' : ''}.
          </p>
        {/if}
        {#if clash}
          <p class="warn-text">More than one device forwards input for this desk.</p>
        {/if}
      </Panel>

      <Panel
        title="Earlier versions"
        hint="Kept on this device before changes were saved, so a bad edit from anyone can be undone: at most one every 5 minutes while the desk changes, the last 10."
      >
        {#if backups.length}
          <ul class="list">
            {#each backups as b (b.path)}
              <li>
                <span>{new Date(b.savedAtMs).toLocaleString()}</span>
                <button class="btn ghost" onclick={() => restore(b)}>Restore as copy</button>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="faint">None yet.</p>
        {/if}
        {#if backupError}<p class="error-text">{backupError}</p>{/if}
      </Panel>
    {/if}
  </Lockable>
</div>

<style>
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
