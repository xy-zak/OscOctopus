// The only module that talks to the Rust core. Every command here maps 1:1 to a
// `#[tauri::command]` in src-tauri/src/commands.rs.
import { Channel, invoke } from '@tauri-apps/api/core';
import type {
  DebugBatch,
  DebugEvent,
  EndpointStatus,
  NetInterface,
  NetworkConfig,
  OscMessage,
  PresetSummary,
} from './types';

export const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const net = {
  /** Applies one desk's config; other desks keep running. Resolves with every status. */
  applyConfig: (desk: string, config: NetworkConfig) =>
    invoke<EndpointStatus[]>('net_apply_config', { desk, config }),
  closeDesk: (desk: string) => invoke<EndpointStatus[]>('net_close_desk', { desk }),
  setPaused: (paused: boolean) => invoke<boolean>('net_set_paused', { paused }),
  paused: () => invoke<boolean>('net_paused'),
  status: () => invoke<EndpointStatus[]>('net_status'),
  listInterfaces: () => invoke<NetInterface[]>('net_list_interfaces'),
};

export const osc = {
  send: (desk: string, outputIds: string[], message: OscMessage, source?: string) =>
    invoke<void>('osc_send', { desk, outputIds, message, source: source ?? null }),
};

export const debug = {
  /** Streams batched debug events to `onBatch`; resolves with the history so far. */
  subscribe: (onBatch: (batch: DebugBatch) => void) => {
    const channel = new Channel<DebugBatch>();
    channel.onmessage = onBatch;
    return invoke<DebugEvent[]>('debug_subscribe', { channel });
  },
  clear: () => invoke<void>('debug_clear'),
  /** Writes Rust's own event history (not the UI's filtered view) to `path`. */
  exportTo: (path: string) => invoke<number>('debug_export', { path }),
};

export const presets = {
  list: () => invoke<PresetSummary[]>('preset_list'),
  load: (id: string) => invoke<unknown>('preset_load', { id }),
  save: (preset: unknown) => invoke<PresetSummary>('preset_save', { preset }),
  remove: (id: string) => invoke<void>('preset_delete', { id }),
  readFile: (path: string) => invoke<unknown>('preset_read_file', { path }),
  exportTo: (id: string, path: string) => invoke<void>('preset_export', { id, path }),
  dir: () => invoke<string>('preset_dir'),
};
