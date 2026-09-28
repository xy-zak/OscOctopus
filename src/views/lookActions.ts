// GLOBAL SETTINGS › LOOK actions: save and delete a custom palette; import, export and delete
// a user skin. Like deskActions.ts, each asks first where it can't be undone and reports a
// failure as an error toast (actions.ts).
import { LIMITS, type CustomPalette } from '../lib/model/preset';
import { BUILTIN_SKINS, DEFAULT_SKIN } from '../lib/skins/builtin';
import { appearance } from '../lib/state/appearance.svelte';
import { skinStore } from '../lib/state/skins.svelte';
import { toast } from '../lib/state/ui.svelte';
import { DEFAULT_PALETTE, PALETTES } from '../lib/theme/palettes';
import { exportJson, ifConfirmed, runAction } from './actions';

/** Why no new palette can be made (LOOK shows it; a refused save says it). */
export const PALETTES_FULL = `${LIMITS.customPalettes.max} custom palettes is the most: delete one to make another.`;

/** Saves a custom palette (new or changed) and switches every desk to it. */
export async function savePalette(palette: CustomPalette): Promise<boolean> {
  const saved = await appearance.saveCustom(palette);
  if (!saved) toast(PALETTES_FULL, 'error');
  return saved;
}

export const deletePalette = (id: string, name: string) =>
  ifConfirmed(
    'Delete',
    {
      title: 'Delete palette',
      message: `Delete the palette “${name}”? This can’t be undone.`,
      details:
        appearance.theme.palette === id
          ? [`Every desk uses it now: they switch to ${PALETTES[DEFAULT_PALETTE].name}.`]
          : undefined,
      confirmLabel: 'Delete',
      danger: true,
    },
    () => appearance.deleteCustom(id),
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
      details: skinStore.isWorn(id)
        ? [
            `Desks wearing it go back to ${BUILTIN_SKINS[DEFAULT_SKIN].name} (or the skin for all desks).`,
          ]
        : undefined,
      confirmLabel: 'Delete',
      danger: true,
    },
    () => skinStore.deleteUser(id),
  );
