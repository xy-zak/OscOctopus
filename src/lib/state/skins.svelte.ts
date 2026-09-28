// Which skin the widgets wear: one for every desk (GLOBAL SETTINGS › LOOK), and optionally
// another for a single desk (DESK › PRESET), and the skins made on this device. Per device,
// like the palette: nothing here is in a preset or synced, so everyone sees a shared desk in
// their own skin.
//
// The choice is its own setting (`skins`), not part of `theme`: a theme that fails to load is
// replaced whole, and that must never take the custom palettes with it (or this with them).
// User skins are files (<app data>/skins/, Rust skins.rs): they embed images, which have no
// place in the settings file.
import { z } from 'zod';
import { skins as skinsIpc } from '../ipc/commands';
import { uid } from '../model/parts';
import { getSetting } from '../platform/settings';
import {
  BUILTIN_SKIN_LIST,
  DEFAULT_SKIN,
  resolveSkin,
  userSkinInfo,
  type SkinInfo,
} from '../skins/builtin';
import { SkinSchema, type Skin } from '../skins/schema';
import { errorText } from '../util';
import { persistSetting } from './persist';

const SkinIdSetting = z.string().min(1).max(64);

/** Each field falls back on its own, so one bad entry never costs the rest. */
export const SkinSelectionSchema = z.object({
  global: SkinIdSetting.catch(DEFAULT_SKIN),
  desks: z.record(z.string(), SkinIdSetting).catch({}),
});
export type SkinSelection = z.infer<typeof SkinSelectionSchema>;

export class SkinError extends Error {}

/** A skin file that can't be used, and why (shown in LOOK, so it can be deleted). */
export interface SkinProblem {
  id: string;
  error: string;
}

const byName = (a: Skin, b: Skin) => a.name.localeCompare(b.name);

/** The first few problems a failed parse found, as one line. */
function issues(error: z.ZodError): string {
  return error.issues
    .slice(0, 4)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}

class SkinStore {
  selection: SkinSelection = $state({ global: DEFAULT_SKIN, desks: {} });
  /** The skins made on this device, by name. */
  user: Skin[] = $state.raw([]);
  problems: SkinProblem[] = $state.raw([]);

  /** Every skin that can be picked, built-in first. */
  get available(): SkinInfo[] {
    return [...BUILTIN_SKIN_LIST, ...this.user.map(userSkinInfo)];
  }

  /** The skin for every desk without its own. */
  get global(): SkinInfo {
    return resolveSkin(this.selection.global, this.available);
  }

  /** The skin a desk's widgets wear: its own if it has one, else the global one. */
  forDesk(deskId: string): SkinInfo {
    const own = this.selection.desks[deskId];
    return own ? resolveSkin(own, this.available) : this.global;
  }

  /** A desk's own skin id, or null when it follows the global one. */
  overrideOf(deskId: string): string | null {
    return this.selection.desks[deskId] ?? null;
  }

  userSkin(id: string): Skin | undefined {
    return this.user.find((s) => s.id === id);
  }

  /** Whether any desk wears this skin, as the global one or its own. */
  isWorn(id: string): boolean {
    return this.selection.global === id || Object.values(this.selection.desks).includes(id);
  }

  async load() {
    const saved = SkinSelectionSchema.safeParse((await getSetting('skins')) ?? {});
    if (saved.success) this.selection = saved.data;
    // Never blocks startup: without its skins the app still has the built-in ones.
    await this.loadUser().catch((e: unknown) => {
      this.problems = [{ id: 'skins', error: `could not read the skins folder: ${errorText(e)}` }];
    });
  }

  /** Reads the skins directory; a file that isn't a valid skin is listed as a problem. */
  async loadUser() {
    const files = await skinsIpc.list();
    const user: Skin[] = [];
    const problems: SkinProblem[] = [];
    for (const f of files) {
      const parsed = f.skin === null ? null : SkinSchema.safeParse(f.skin);
      if (parsed?.success) user.push(parsed.data);
      else problems.push({ id: f.id, error: f.error ?? (parsed ? issues(parsed.error) : '?') });
    }
    this.user = user.sort(byName);
    this.problems = problems;
  }

  async setGlobal(id: string) {
    this.selection.global = id;
    await this.save();
  }

  /** `null` makes the desk follow the global skin again. */
  async setDesk(deskId: string, id: string | null) {
    if (id === null) delete this.selection.desks[deskId];
    else this.selection.desks[deskId] = id;
    await this.save();
  }

  /** A desk's preset was deleted: its choice goes with it (closing a tab keeps it). */
  async forgetDesk(deskId: string) {
    if (!(deskId in this.selection.desks)) return;
    delete this.selection.desks[deskId];
    await this.save();
  }

  /** Validates and saves a user skin (new or changed). */
  async saveUser(skin: Skin) {
    const valid = SkinSchema.parse(skin);
    await skinsIpc.save(valid);
    this.user = [...this.user.filter((s) => s.id !== valid.id), valid].sort(byName);
  }

  /** Deletes a user skin; desks that wore it go back to TERMINAL (or the global skin). */
  async deleteUser(id: string) {
    await skinsIpc.remove(id);
    this.user = this.user.filter((s) => s.id !== id);
    this.problems = this.problems.filter((p) => p.id !== id);
    if (!this.isWorn(id)) return;
    if (this.selection.global === id) this.selection.global = DEFAULT_SKIN;
    for (const [desk, skin] of Object.entries(this.selection.desks)) {
      if (skin === id) delete this.selection.desks[desk];
    }
    await this.save();
  }

  /**
   * Adds a skin from a file's text (a shared skin). A skin whose id is taken by another one
   * here comes in as a copy with a new id, so nothing is overwritten.
   */
  async importText(text: string): Promise<Skin> {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      throw new SkinError(`not a skin file: ${errorText(e)}`);
    }
    const parsed = SkinSchema.safeParse(raw);
    if (!parsed.success) throw new SkinError(`not a valid skin: ${issues(parsed.error)}`);
    const skin = parsed.data;
    if (this.userSkin(skin.id)) skin.id = newSkinId();
    await this.saveUser(skin);
    return skin;
  }

  exportTo(id: string, path: string): Promise<void> {
    return skinsIpc.exportTo(id, path);
  }

  private async save() {
    await persistSetting('skins', $state.snapshot(this.selection));
  }
}

/** A fresh user skin id (`skin-…`, see schema.ts). */
export const newSkinId = () => uid('skin');

export const skinStore = new SkinStore();
