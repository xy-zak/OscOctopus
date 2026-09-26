import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { EndpointStatus } from './types';

/** Fired by Rust whenever an endpoint's state changes (not on every packet). */
export const onNetStatus = (cb: (s: EndpointStatus) => void): Promise<UnlistenFn> =>
  listen<EndpointStatus>('net://status', (e) => cb(e.payload));
