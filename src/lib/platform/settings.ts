// Per-device app settings (not part of any preset), persisted by tauri-plugin-store in the
// app data directory as settings.json.
import { LazyStore } from '@tauri-apps/plugin-store';
import type { Theme } from '../model/preset';

const store = new LazyStore('settings.json');

export interface Settings {
  /** Pre-desks setting; used once to migrate to `openDesks`. */
  lastPresetId: string | null;
  infoOpen: boolean;
  /** Preset ids open as desk tabs, in tab order. */
  openDesks: string[];
  activeDesk: string | null;
  /** Survive restarts: a crash mid-show must not unlock the desk or resume output. */
  locked: boolean;
  paused: boolean;
  /** Global palette, accent and background (shared by every desk). */
  theme: Theme;
}

export async function getSetting<K extends keyof Settings>(
  key: K,
): Promise<Settings[K] | undefined> {
  try {
    return await store.get<Settings[K]>(key);
  } catch {
    return undefined;
  }
}

/** Throws if the store can't be written; use `persistSetting` (state/persist.ts) to report it. */
export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  await store.set(key, value);
  await store.save();
}
