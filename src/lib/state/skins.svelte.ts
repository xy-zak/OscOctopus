// The skins made on this device, besides the built-in ones. Which skin a desk wears is part of
// its look (state/look.svelte.ts). User skins are files (<app data>/skins/, Rust skins.rs):
// they embed images, which have no place in the settings file.
import { z } from 'zod';
import { skins as skinsIpc } from '../ipc/commands';
import { uid } from '../model/parts';
import { BUILTIN_SKIN_LIST, userSkinInfo, type SkinInfo } from '../skins/builtin';
import { SkinSchema, type Skin } from '../skins/schema';
import { errorText } from '../util';

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
  /** The skins made on this device, by name. */
  user: Skin[] = $state.raw([]);
  problems: SkinProblem[] = $state.raw([]);

  /** Every skin that can be picked, built-in first. */
  get available(): SkinInfo[] {
    return [...BUILTIN_SKIN_LIST, ...this.user.map(userSkinInfo)];
  }

  userSkin(id: string): Skin | undefined {
    return this.user.find((s) => s.id === id);
  }

  async load() {
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

  /** Validates and saves a user skin (new or changed). */
  async saveUser(skin: Skin) {
    const valid = SkinSchema.parse(skin);
    await skinsIpc.save(valid);
    this.user = [...this.user.filter((s) => s.id !== valid.id), valid].sort(byName);
  }

  /** Deletes a user skin (lookStore.forget takes it off the desks that wear it). */
  async deleteUser(id: string) {
    await skinsIpc.remove(id);
    this.user = this.user.filter((s) => s.id !== id);
    this.problems = this.problems.filter((p) => p.id !== id);
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
}

/** A fresh user skin id (`skin-…`, see schema.ts). */
export const newSkinId = () => uid('skin');

export const skinStore = new SkinStore();
