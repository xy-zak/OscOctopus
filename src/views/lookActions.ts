// GLOBAL SETTINGS › LOOK actions: save and delete a custom palette; import, export and delete
// a user skin. Like deskActions.ts, each asks first where it can't be undone and reports a
// failure as an error toast (actions.ts).
import { LIMITS, type CustomPalette } from '../lib/model/preset';
import { BUILTIN_SKINS, DEFAULT_SKIN } from '../lib/skins/builtin';
import { appearance } from '../lib/state/appearance.svelte';
import { lookStore } from '../lib/state/look.svelte';
import { skinStore } from '../lib/state/skins.svelte';
import { toast } from '../lib/state/ui.svelte';
import { DEFAULT_PALETTE, PALETTES } from '../lib/theme/palettes';
import { exportJson, ifConfirmed, runAction } from './actions';

/** Why no new palette can be made (LOOK shows it; a refused save says it). */
export const PALETTES_FULL = `${LIMITS.customPalettes.max} custom palettes is the most: delete one to make another.`;

/**
 * Saves a custom palette. A new one becomes the palette of every desk (desks with their own
 * keep it); a changed one recolours whatever wears it.
 */
export async function savePalette(palette: CustomPalette): Promise<boolean> {
  const isNew = !appearance.theme.custom.some((p) => p.id === palette.id);
  const saved = await appearance.saveCustom(palette);
  if (!saved) toast(PALETTES_FULL, 'error');
  else if (isNew) await lookStore.choose(null, 'palette', palette.id);
  return saved;
}

export const deletePalette = (id: string, name: string) =>
  ifConfirmed(
    'Delete',
    {
      title: 'Delete palette',
      message: `Delete the palette “${name}”? This can’t be undone.`,
      details: lookStore.wears('palette', id)
        ? [
            `Desks using it switch to ${PALETTES[DEFAULT_PALETTE].name} (or the palette for all desks).`,
          ]
        : undefined,
      confirmLabel: 'Delete palette',
      danger: true,
    },
    async () => {
      await appearance.deleteCustom(id);
      await lookStore.forget('palette', id);
    },
  );

/** Adds a skin from a file the user picked (a file input: it works on every platform). */
export const importSkinFile = (file: File) =>
  runAction('Import', async () => {
    const skin = await skinStore.importText(await file.text());
    toast(`Imported the skin “${skin.name}”`);
  });

export function exportSkin(id: string) {
  const skin = skinStore.userSkin(id);
  if (!skin) return Promise.resolve(false);
  return exportJson('skin', skin.name, (path) => skinStore.exportTo(id, path));
}

export const deleteSkin = (id: string, name: string) =>
  ifConfirmed(
    'Delete',
    {
      title: 'Delete skin',
      message: `Delete the skin “${name}”? This can’t be undone.`,
      details: lookStore.wears('skin', id)
        ? [
            `Desks wearing it go back to ${BUILTIN_SKINS[DEFAULT_SKIN].name} (or the skin for all desks).`,
          ]
        : undefined,
      confirmLabel: 'Delete skin',
      danger: true,
    },
    async () => {
      await skinStore.deleteUser(id);
      await lookStore.forget('skin', id);
    },
  );
