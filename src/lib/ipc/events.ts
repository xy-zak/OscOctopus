import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { EndpointStatus, SyncStatus } from './types';

/** Fired by Rust whenever an endpoint's state changes (not on every packet). */
export const onNetStatus = (cb: (s: EndpointStatus) => void): Promise<UnlistenFn> =>
  listen<EndpointStatus>('net://status', (e) => cb(e.payload));

/** Fired by Rust when sync peers, targets or settings change, and every heartbeat while joined. */
export const onSyncStatus = (cb: (s: SyncStatus) => void): Promise<UnlistenFn> =>
  listen<SyncStatus>('sync://status', (e) => cb(e.payload));
