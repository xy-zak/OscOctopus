// The global look: one palette and accent shared by every desk (a device setting, not part of
// any preset). Widgets store palette *indices*, so switching palette recolours all desks.
import { ThemeSchema, type Theme } from '../model/preset';
import { getSetting, setSetting } from '../platform/settings';

export const DEFAULT_THEME: Theme = { palette: 'rainbow', accent: 5, mode: 'dark' };

class AppearanceStore {
  theme: Theme = $state({ ...DEFAULT_THEME });
  private loaded = false;

  /**
   * Loads the saved theme. `fallback` (e.g. a v3 preset's old per-desk theme) is used only
   * when nothing has been saved yet, so upgrading keeps the desk's colours.
   */
  async load(fallback?: unknown) {
    if (this.loaded) return;
    this.loaded = true;
    const saved = ThemeSchema.safeParse(await getSetting('theme'));
    const seed = ThemeSchema.safeParse(fallback);
    this.theme = saved.success ? saved.data : seed.success ? seed.data : { ...DEFAULT_THEME };
    if (!saved.success) await this.save();
  }

  async set(patch: Partial<Theme>) {
    this.theme = { ...this.theme, ...patch };
    await this.save();
  }

  private async save() {
    await setSetting('theme', $state.snapshot(this.theme)).catch(() => {});
  }
}

export const appearance = new AppearanceStore();
