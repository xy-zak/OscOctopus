// Per-device app settings (not part of any preset), persisted by tauri-plugin-store in the
// app data directory as settings.json (profiles/<name>/settings.json when the app runs as a
// profile, see OSCOCTOPUS_PROFILE in src-tauri/src/lib.rs).
import { LazyStore } from '@tauri-apps/plugin-store';
import { app } from '../ipc/commands';
import type { SyncConfig } from '../ipc/types';
import type { Theme } from '../model/preset';
import type { SkinSelection } from '../state/skins.svelte';
import type { InfoSection, InspectorSection } from '../state/ui.svelte';

let storePromise: Promise<LazyStore> | null = null;

/** The store of this app's profile, opened on first use. */
function store(): Promise<LazyStore> {
  storePromise ??= app
    .profile()
    .catch(() => null)
    .then(
      (profile) => new LazyStore(profile ? `profiles/${profile}/settings.json` : 'settings.json'),
    );
  return storePromise;
}

export interface Settings {
  /** Pre-desks setting; used once to migrate to `openDesks`. */
  lastPresetId: string | null;
  infoOpen: boolean;
  /** Which Inspector sections are unfolded (saved once the user folds or unfolds one). */
  inspectorSections: Partial<Record<InspectorSection, boolean>>;
  /** Which live-mode info panel sections are unfolded (saved once the user toggles one). */
  infoSections: Partial<Record<InfoSection, boolean>>;
  /** Preset ids open as desk tabs, in tab order. */
  openDesks: string[];
  activeDesk: string | null;
  /** Whether incoming OSC may drive widgets (the IN switch). */
  inputEnabled: boolean;
  /** Survive restarts: a crash mid-show must not unlock the desk or resume output. */
  locked: boolean;
  paused: boolean;
  /** Global palette, accent and background (shared by every desk). */
  theme: Theme;
  /** Widget skin for every desk, and any desk's own (see state/skins.svelte.ts). */
  skins: SkinSelection;
  /** How this device is named to sync peers (its colour is the theme's accent). */
  syncName: string;
  syncConfig: SyncConfig;
  /** Peer ids refused on this device. */
  syncBlocked: string[];
  /** Rejoin the remembered session at startup. */
  syncAutoJoin: boolean;
  /** Shared desks whose received OSC input this device forwards. */
  syncForwarding: string[];
}

export async function getSetting<K extends keyof Settings>(
  key: K,
): Promise<Settings[K] | undefined> {
  try {
    return await (await store()).get<Settings[K]>(key);
  } catch {
    return undefined;
  }
}

/** Throws if the store can't be written; use `persistSetting` (state/persist.ts) to report it. */
export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  const s = await store();
  await s.set(key, value);
  await s.save();
}
