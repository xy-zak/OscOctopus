import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { EndpointStatus, IncomingOsc } from './types';

/** Fired by Rust whenever an endpoint's state changes (not on every packet). */
export const onNetStatus = (cb: (s: EndpointStatus) => void): Promise<UnlistenFn> =>
  listen<EndpointStatus>('net://status', (e) => cb(e.payload));

/** Every successfully decoded inbound packet; intended for widget feedback. */
export const onIncomingOsc = (cb: (m: IncomingOsc) => void): Promise<UnlistenFn> =>
  listen<IncomingOsc>('osc://incoming', (e) => cb(e.payload));
