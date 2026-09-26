// The sync session as the UI sees it: this device's profile and connection settings, joining
// and leaving, the peers connected right now and their presence. `bus` is the typed,
// validated message bus the sync modules use (bus.ts).
import { sync } from '../ipc/commands';
import { onSyncStatus } from '../ipc/events';
import type { AppKind, PeerInfo, SyncConfig, SyncStatus } from '../ipc/types';
import { untrack } from 'svelte';
import { CURRENT_SCHEMA_VERSION } from '../model/preset';
import { getSetting } from '../platform/settings';
import { appearance } from '../state/appearance.svelte';
import { debugStore } from '../state/debug.svelte';
import { persistSetting } from '../state/persist';
import { errorText } from '../util';
import { SyncBus } from './bus';
import type { Presence } from './protocol';
import { tauriTransport, type Transport } from './transport';

/** At most one "ignored a message" log line per peer per this many ms. */
const REJECT_LOG_MS = 5000;

class SyncSession {
  status: SyncStatus | null = $state.raw(null);
  /** Connected peers, maintained from up/down events (in order with their messages). */
  peers: Record<string, PeerInfo> = $state({});
  presence: Record<string, Presence> = $state({});
  /** The session whose key is remembered on this device. */
  remembered: string | null = $state(null);
  autoJoin = $state(false);
  busy = $state(false);
  error: string | null = $state(null);
  /** Invalid messages ignored, per peer. */
  rejected: Record<string, number> = $state({});

  bus: SyncBus = this.makeBus(tauriTransport);
  private lastRejectLog = new Map<string, number>();
  private started = false;

  get joined(): boolean {
    return this.status?.session != null;
  }

  /** This device's id (known once started). */
  get peerId(): string | null {
    return this.status?.local.peerId ?? null;
  }

  /** Replaces the Rust transport (tests). Call before `start`. */
  useTransport(transport: Transport) {
    this.bus = this.makeBus(transport);
  }

  private makeBus(transport: Transport): SyncBus {
    const bus = new SyncBus(transport, {
      rejected: (peer, kind, error) => this.reject(peer, kind, error),
      sendFailed: (kind, e) =>
        debugStore.local(`sync: could not send ${kind}: ${errorText(e)}`, undefined, 'sync'),
    });
    // Registered first, so every other handler already sees the peer (or its absence).
    bus.onPeers((c) => {
      if (c.type === 'up') this.peers[c.peer.peerId] = c.peer;
      else {
        delete this.peers[c.peer];
        delete this.presence[c.peer];
      }
    });
    bus.on('presence', (peer, _desk, body) => (this.presence[peer] = body));
    return bus;
  }

  async start() {
    if (this.started) return;
    this.started = true;
    await this.bus.listen((count) =>
      debugStore.local(`sync: ${count} messages dropped (the UI fell behind)`, undefined, 'sync'),
    );
    await onSyncStatus((s) => (this.status = s));
    const status = await sync.status();
    this.status = status;
    const name = (await getSetting('syncName')) ?? `OscOctopus ${status.local.peerId.slice(0, 4)}`;
    this.status = await sync.setProfile(name, appearance.theme.accent);
    // Others see this device in its accent colour (GLOBAL SETTINGS › LOOK), kept in step.
    $effect.root(() => {
      $effect(() => {
        const accent = appearance.theme.accent;
        untrack(() => {
          const profile = this.status?.local.profile;
          if (profile && profile.color !== accent)
            void sync.setProfile(profile.name, accent).then((s) => (this.status = s));
        });
      });
    });
    const config = await getSetting('syncConfig');
    if (config) await this.setConfig(config, false);
    const blocked = await getSetting('syncBlocked');
    if (blocked?.length) this.status = await sync.setBlocked(blocked);
    this.remembered = await sync.remembered();
    this.autoJoin = (await getSetting('syncAutoJoin')) ?? false;
    if (this.autoJoin && this.remembered) await this.join(this.remembered, null, true);
  }

  peerName(peerId: string): string {
    return this.peers[peerId]?.name ?? peerId.slice(0, 8);
  }

  private reject(peer: string, kind: AppKind, error: string) {
    this.rejected[peer] = (this.rejected[peer] ?? 0) + 1;
    const now = Date.now();
    if (now - (this.lastRejectLog.get(peer) ?? 0) < REJECT_LOG_MS) return;
    this.lastRejectLog.set(peer, now);
    debugStore.local(
      `sync: ignored an invalid ${kind} from ${this.peerName(peer)} (${error})`,
      undefined,
      'sync',
    );
  }

  // ---- session and settings -----------------------------------------------------------------

  private async run(action: () => Promise<void>) {
    this.busy = true;
    this.error = null;
    try {
      await action();
    } catch (e) {
      this.error = errorText(e);
    } finally {
      this.busy = false;
    }
  }

  /** `secret` null uses the remembered key. */
  join(session: string, secret: string | null, remember: boolean) {
    return this.run(async () => {
      this.status = await sync.join(session, secret, remember, CURRENT_SCHEMA_VERSION);
      this.remembered = remember ? session.trim() : null;
      if (!remember && this.autoJoin) await this.setAutoJoin(false);
    });
  }

  leave() {
    return this.run(async () => {
      this.status = await sync.leave();
    });
  }

  forget() {
    return this.run(async () => {
      await sync.forget();
      this.remembered = null;
      await this.setAutoJoin(false);
    });
  }

  async setAutoJoin(on: boolean) {
    this.autoJoin = on;
    await persistSetting('syncAutoJoin', on);
  }

  newKey(): Promise<string> {
    return sync.newKey();
  }

  /** How this device is named to others (its colour is the LOOK accent). */
  async setName(name: string) {
    this.status = await sync.setProfile(name, appearance.theme.accent);
    await persistSetting('syncName', this.status.local.profile.name);
  }

  /** Applies connection settings; resolves false (with `error` set) if they were refused. */
  async setConfig(config: SyncConfig, persist = true): Promise<boolean> {
    try {
      this.status = await sync.setConfig(config);
      if (persist) await persistSetting('syncConfig', this.status.config);
      return true;
    } catch (e) {
      this.error = errorText(e);
      return false;
    }
  }

  async setBlocked(peerIds: string[]) {
    this.status = await sync.setBlocked(peerIds);
    await persistSetting('syncBlocked', this.status.blocked);
  }

  block(peerId: string) {
    return this.setBlocked([...(this.status?.blocked ?? []), peerId]);
  }

  unblock(peerId: string) {
    return this.setBlocked((this.status?.blocked ?? []).filter((p) => p !== peerId));
  }
}

export const syncSession = new SyncSession();
