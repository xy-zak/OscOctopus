// The look chosen on this device (theme/look.ts): one for every desk, and what each desk makes
// its own. The one place that says which palette, ACTIVE colour and skin a desk has: App.svelte
// applies it, the pickers (views/PalettePicker, ActivePicker, SkinPicker) change it, for every
// desk or for one.
//
// Its own setting (`look`): what it points at are the custom palettes (`theme`, appearance) and
// the user skins (files, skinStore), and a bad entry in either must never cost the other.
import { getSetting } from '../platform/settings';
import { hasPalette } from '../theme/palettes';
import {
  DEFAULT_ACTIVE,
  DEFAULT_LOOK,
  LookSettingSchema,
  resolveLook,
  type DeskLook,
  type Look,
  type LookField,
  type LookLibrary,
  type LookSetting,
  type ResolvedLook,
} from '../theme/look';
import { appearance } from './appearance.svelte';
import { persistSetting } from './persist';
import { skinStore } from './skins.svelte';

const fresh = (): LookSetting => ({ global: { ...DEFAULT_LOOK }, desks: {} });

class LookStore {
  setting: LookSetting = $state(fresh());

  private get library(): LookLibrary {
    return { custom: appearance.theme.custom, skins: skinStore.available };
  }

  /** The look of every desk that has none of its own. */
  get global(): ResolvedLook {
    return resolveLook(this.setting, null, this.library);
  }

  /** A desk's look: its own choices, and every desk's for the rest. */
  forDesk(deskId: string): ResolvedLook {
    return resolveLook(this.setting, deskId, this.library);
  }

  /** What a desk made its own. */
  own(deskId: string): DeskLook {
    return this.setting.desks[deskId] ?? {};
  }

  hasOwn(deskId: string): boolean {
    return Object.keys(this.own(deskId)).length > 0;
  }

  /**
   * What is chosen for `field`, for every desk (`desk` null) or for one: null when that desk
   * has no choice of its own. A palette or skin that is gone counts as no choice (it isn't
   * what the desk shows).
   */
  chosen<K extends LookField>(desk: string | null, field: K): Look[K] | null {
    if (desk === null) {
      const g = this.global;
      const shown: Look = {
        palette: g.paletteId as Look['palette'],
        active: g.active,
        skin: g.skin.id,
      };
      return shown[field];
    }
    const own = this.own(desk)[field];
    return own !== undefined && this.exists(field, own) ? own : null;
  }

  /**
   * Chooses for every desk (`desk` null) or one; null makes a desk follow every desk again.
   * `save` false only shows it (a colour still being picked), until a choice that saves.
   */
  async choose<K extends LookField>(
    desk: string | null,
    field: K,
    value: Look[K] | null,
    save = true,
  ) {
    if (desk === null) {
      if (value === null) return;
      this.setting.global[field] = value;
    } else {
      const own: DeskLook = { ...this.own(desk) };
      if (value === null) delete own[field];
      else own[field] = value;
      this.setDesk(desk, own);
    }
    if (save) await this.save();
  }

  /**
   * Takes a project's look (lib/model/project.ts): every desk's, and its desks' own (`renamed`
   * maps a desk that came back under a new id). Other desks keep theirs.
   */
  async restore(look: LookSetting, desks: readonly string[], renamed: ReadonlyMap<string, string>) {
    const next = { ...this.setting.desks };
    for (const id of desks) delete next[renamed.get(id) ?? id];
    for (const [id, own] of Object.entries(look.desks)) next[renamed.get(id) ?? id] = { ...own };
    this.setting = { global: { ...look.global }, desks: next };
    await this.save();
  }

  /** The desk takes every desk's look again. */
  async resetDesk(deskId: string) {
    if (!this.hasOwn(deskId)) return;
    this.setDesk(deskId, {});
    await this.save();
  }

  /** A desk's preset was deleted: its look goes with it (closing a tab keeps it). */
  async forgetDesk(deskId: string) {
    await this.resetDesk(deskId);
  }

  /** A copy of a desk (DUPLICATE) looks like it. */
  async copyDesk(from: string, to: string) {
    if (!this.hasOwn(from)) return;
    this.setDesk(to, { ...this.own(from) });
    await this.save();
  }

  /** Whether any desk wears this palette or skin: every desk's, or one's own. */
  wears(field: 'palette' | 'skin', id: string): boolean {
    const { global, desks } = this.setting;
    return global[field] === id || Object.values(desks).some((d) => d[field] === id);
  }

  /**
   * A custom palette or user skin is gone: every desk's look goes back to the default, and a
   * desk that had it as its own takes every desk's.
   */
  async forget(field: 'palette' | 'skin', id: string) {
    if (!this.wears(field, id)) return;
    const { global, desks } = this.setting;
    if (global[field] === id) {
      this.setting.global = { ...global, [field]: DEFAULT_LOOK[field] };
    }
    for (const [deskId, own] of Object.entries(desks)) {
      if (own[field] !== id) continue;
      const rest = { ...own };
      delete rest[field];
      this.setDesk(deskId, rest);
    }
    await this.save();
  }

  /**
   * Loads the saved look. Before there was one, the palette was part of the theme (before
   * that, of the first desk's preset: `legacyTheme`) and the skins had a setting of their own;
   * they are carried over once, with the default ACTIVE green.
   */
  async load(legacyTheme?: unknown) {
    const saved = await getSetting('look');
    if (saved !== undefined) {
      const parsed = LookSettingSchema.safeParse(saved);
      this.setting = parsed.success ? parsed.data : fresh();
      return;
    }
    type Old = { palette?: unknown } | null | undefined;
    const palette = ((await getSetting('theme')) as Old)?.palette ?? (legacyTheme as Old)?.palette;
    const skins = (await getSetting('skins')) as
      | {
          global?: unknown;
          desks?: Record<string, unknown>;
        }
      | undefined;
    const desks = skins?.desks && typeof skins.desks === 'object' ? skins.desks : {};
    const parsed = LookSettingSchema.safeParse({
      global: { palette, active: DEFAULT_ACTIVE, skin: skins?.global },
      desks: Object.fromEntries(Object.entries(desks).map(([id, skin]) => [id, { skin }])),
    });
    this.setting = parsed.success ? parsed.data : fresh();
    await this.save();
  }

  private exists(field: LookField, value: unknown): boolean {
    if (field === 'palette') return hasPalette(String(value), appearance.theme.custom);
    if (field === 'skin') return skinStore.available.some((s) => s.id === value);
    return true;
  }

  /** Sets a desk's own choices; none drops its entry. */
  private setDesk(deskId: string, own: DeskLook) {
    const desks = { ...this.setting.desks };
    if (Object.keys(own).length === 0) delete desks[deskId];
    else desks[deskId] = own;
    this.setting.desks = desks;
  }

  private async save() {
    await persistSetting('look', $state.snapshot(this.setting));
  }
}

export const lookStore = new LookStore();
