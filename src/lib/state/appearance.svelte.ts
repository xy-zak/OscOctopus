// The global look: one palette and accent shared by every desk (a device setting, not part of
// any preset), plus the custom palettes made on this device. Widgets store palette *indices*,
// so switching palette recolours all desks.
import { LIMITS, ThemeSchema, type CustomPalette, type Theme } from '../model/preset';
import { getSetting } from '../platform/settings';
import {
  DEFAULT_ACCENT,
  DEFAULT_PALETTE,
  resolvePalette,
  withCustomPalette,
  withoutCustomPalette,
  type Palette,
} from '../theme/palettes';
import { persistSetting } from './persist';

export const DEFAULT_THEME: Theme = {
  palette: DEFAULT_PALETTE,
  accent: DEFAULT_ACCENT,
  mode: 'dark',
  custom: [],
};

class AppearanceStore {
  theme: Theme = $state({ ...DEFAULT_THEME });
  private loaded = false;

  /** The palette in use, built-in or custom. */
  get palette(): Palette {
    return resolvePalette(this.theme.palette, this.theme.custom);
  }

  /** No room for another custom palette (a saved theme over the cap would not load). */
  get customFull(): boolean {
    return this.theme.custom.length >= LIMITS.customPalettes.max;
  }

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

  /**
   * Adds or updates a custom palette and switches every desk to it. Resolves false, changing
   * nothing, for a new palette while `customFull`.
   */
  async saveCustom(palette: CustomPalette): Promise<boolean> {
    const isNew = !this.theme.custom.some((p) => p.id === palette.id);
    if (isNew && this.customFull) return false;
    this.theme = { ...withCustomPalette(this.theme, palette), palette: palette.id };
    await this.save();
    return true;
  }

  async deleteCustom(id: string) {
    this.theme = withoutCustomPalette(this.theme, id);
    await this.save();
  }

  private async save() {
    await persistSetting('theme', $state.snapshot(this.theme));
  }
}

export const appearance = new AppearanceStore();
