// The only module that talks to the Rust core. Every command here maps 1:1 to a
// `#[tauri::command]` in src-tauri/src/commands.rs.
import { Channel, invoke } from '@tauri-apps/api/core';
import type {
  AppKind,
  Avoid,
  Backup,
  DebugBatch,
  InputBatch,
  DebugEvent,
  EndpointStatus,
  NetInterface,
  NetworkConfig,
  OscMessage,
  PresetSummary,
  SyncBatch,
  SyncConfig,
  SyncStatus,
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
  /** `avoid` (forwarded input only) keeps the message from going back to its sender. */
  send: (desk: string, outputIds: string[], message: OscMessage, source?: string, avoid?: Avoid) =>
    invoke<void>('osc_send', {
      desk,
      outputIds,
      message,
      source: source ?? null,
      avoid: avoid ?? null,
    }),
};

export const input = {
  /** Streams inbound messages for input mapping (~60 Hz batches) to `onBatch`. */
  subscribe: (onBatch: (batch: InputBatch) => void) => {
    const channel = new Channel<InputBatch>();
    channel.onmessage = onBatch;
    return invoke<void>('input_subscribe', { channel });
  },
  /** The master gate (the IN switch). Resolves with the new state. */
  setEnabled: (enabled: boolean) => invoke<boolean>('input_set_enabled', { enabled }),
  enabled: () => invoke<boolean>('input_enabled'),
  /** The endpoints of a desk that a widget listens on. */
  setListen: (desk: string, endpointIds: string[]) =>
    invoke<void>('input_set_listen', { desk, endpointIds }),
};

export const sync = {
  status: () => invoke<SyncStatus>('sync_status'),
  /** Streams peers coming and going, and their messages (~60 Hz batches), to `onBatch`. */
  subscribe: (onBatch: (batch: SyncBatch) => void) => {
    const channel = new Channel<SyncBatch>();
    channel.onmessage = onBatch;
    return invoke<void>('sync_subscribe', { channel });
  },
  /** Without `secret`, uses the key remembered for this session name. */
  join: (session: string, secret: string | null, remember: boolean, schemaVersion: number) =>
    invoke<SyncStatus>('sync_join', { session, secret, remember, schemaVersion }),
  leave: () => invoke<SyncStatus>('sync_leave'),
  newKey: () => invoke<string>('sync_new_key'),
  /** The session whose key is remembered on this device. */
  remembered: () => invoke<string | null>('sync_remembered'),
  forget: () => invoke<void>('sync_forget'),
  setProfile: (name: string, color: number) =>
    invoke<SyncStatus>('sync_set_profile', { name, color }),
  setConfig: (config: SyncConfig) => invoke<SyncStatus>('sync_set_config', { config }),
  /** Desks shared (or being joined) here; peers' messages about other desks are dropped. */
  setDesks: (desks: string[]) => invoke<void>('sync_set_desks', { desks }),
  setBlocked: (peerIds: string[]) => invoke<SyncStatus>('sync_set_blocked', { peerIds }),
  /** Queues `body` (JSON text) for one peer or all; resolves with how many it was queued for. */
  send: (peer: string | null, kind: AppKind, desk: string | null, body: string) =>
    invoke<number>('sync_send', { peer, kind, desk, body }),
  /** A shared desk's sync record, or null. */
  docLoad: (desk: string) => invoke<unknown>('sync_doc_load', { desk }),
  /** Saves a shared desk: its record first, then the preset. */
  deskSave: (preset: unknown, record: unknown) =>
    invoke<PresetSummary>('sync_desk_save', { preset, record }),
  docDelete: (desk: string) => invoke<void>('sync_doc_delete', { desk }),
  /** Earlier versions of a shared desk, newest first. */
  backups: (desk: string) => invoke<Backup[]>('sync_backups', { desk }),
};

export const app = {
  /** The profile this instance runs as (OSCOCTOPUS_PROFILE), or null. */
  profile: () => invoke<string | null>('app_profile'),
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
