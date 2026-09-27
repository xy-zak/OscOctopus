// User skin actions for LOOK: import a skin file, export one, delete one. Like deskActions.ts,
// each asks first where it can't be undone and reports a failure as an error toast.
import { save } from '@tauri-apps/plugin-dialog';
import { skinStore } from '../lib/state/skins.svelte';
import { confirmAction, toast } from '../lib/state/ui.svelte';
import { runAction } from './deskActions';

const SKIN_FILES = [{ name: 'OscOctopus skin', extensions: ['json'] }];

/** Adds a skin from a file the user picked (a file input: it works on every platform). */
export const importSkinFile = (file: File) =>
  runAction('Import', async () => {
    const skin = await skinStore.importText(await file.text());
    toast(`Imported the skin “${skin.name}”`);
  });

export function exportSkin(id: string) {
  const skin = skinStore.userSkin(id);
  if (!skin) return Promise.resolve(false);
  return runAction('Export', async () => {
    const safe = skin.name.replace(/[^\w\- ]+/g, '').trim() || 'skin';
    const path = await save({ defaultPath: `${safe}.json`, filters: SKIN_FILES });
    if (!path) return;
    await skinStore.exportTo(id, path);
    toast(`Exported to ${path}`);
  });
}

export async function deleteSkin(id: string, name: string) {
  const inUse =
    skinStore.selection.global === id || Object.values(skinStore.selection.desks).includes(id);
  const ok = await confirmAction({
    title: 'Delete skin',
    message: `Delete the skin “${name}”? This can’t be undone.`,
    details: inUse
      ? ['Desks wearing it go back to TERMINAL (or the skin for all desks).']
      : undefined,
    confirmLabel: 'Delete',
    danger: true,
  });
  return ok && runAction('Delete', () => skinStore.deleteUser(id));
}
