// Saves a per-device setting and says so when it can't. FREEZE and PAUSE (OSC-OUT off) promise to
// survive a restart, so a failed write must be visible (Traffic log + toast), never swallowed.
import { setSetting, type Settings } from '../platform/settings';
import { errorText } from '../util';
import { debugStore } from './debug.svelte';
import { toast } from './ui.svelte';

export async function persistSetting<K extends keyof Settings>(
  key: K,
  value: Settings[K],
): Promise<boolean> {
  try {
    await setSetting(key, value);
    return true;
  } catch (e) {
    const text = `could not save setting "${key}": ${errorText(e)}`;
    debugStore.local(text, undefined, 'settings');
    toast(text, 'error');
    return false;
  }
}
