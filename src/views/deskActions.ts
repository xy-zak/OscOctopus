// Workspace actions shared by the tab bar, a desk's LOOK section and GLOBAL SETTINGS ›
// LIBRARY. Each asks first (the confirmation texts live here, once), runs, and reports a
// failure as an error toast (actions.ts). They resolve true when the action went through.
import { open } from '@tauri-apps/plugin-dialog';
import type { Preset } from '../lib/model/preset';
import { presetStore } from '../lib/state/preset.svelte';
import { confirmAction, toast } from '../lib/state/ui.svelte';
import { sharedDesks } from '../lib/sync/app.svelte';
import { exportJson, ifConfirmed, jsonFiles, runAction } from './actions';

const PRESET_FILES = jsonFiles('preset');
const STARTS_NOW = 'Its outputs and inputs start immediately, alongside the open desks.';
const PORT_CLASH =
  'Inputs on the same ports as the original will fail to bind; its NETWORK section will say so.';
const REOPEN = 'The preset stays saved: reopen it from + or GLOBAL SETTINGS › LIBRARY.';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const endpointsOf = (d: Preset) =>
  `${plural(d.network.outputs.length, 'output')} and ${plural(d.network.inputs.length, 'input')}`;
const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

export const addDesk = (name: string) =>
  ifConfirmed(
    'Add desk',
    {
      title: 'Add desk',
      message: `Create a new blank desk "${name}"?`,
      details: [
        'It gets one UDP output to 127.0.0.1:9000 and starts immediately, alongside the open desks.',
        'It is saved as a new preset; rename it in the desk’s LOOK section.',
      ],
      confirmLabel: 'Add desk',
    },
    () => presetStore.newDesk(name),
  );

/** Copies the active desk into a new preset, opened as a new desk. */
export function duplicateDesk() {
  const src = presetStore.current;
  const name = `${src.name} copy`;
  return ifConfirmed(
    'Duplicate desk',
    {
      title: 'Duplicate desk',
      message: `Open a copy of "${src.name}" as a new desk "${name}"?`,
      details: [
        `Its ${endpointsOf(src)} start immediately, and it is saved as a new preset.`,
        PORT_CLASH,
      ],
      confirmLabel: 'Duplicate',
    },
    () => presetStore.duplicateDesk(name),
  );
}

export const openDesk = (id: string, name: string) =>
  ifConfirmed(
    'Open desk',
    {
      title: 'Open desk',
      message: `Open saved preset "${name}" as a new desk?`,
      details: [STARTS_NOW],
      confirmLabel: 'Open desk',
    },
    () => presetStore.openDesk(id),
  );

/** Removes a desk from the workspace; its preset stays saved. */
export function removeDesk(id: string) {
  const desk = presetStore.desks.find((d) => d.id === id);
  if (!desk) return Promise.resolve(false);
  return ifConfirmed(
    'Remove desk',
    {
      title: 'Remove desk',
      message: `Remove desk "${desk.name}" from the workspace?`,
      details: [`Its ${endpointsOf(desk)} stop and their sockets close.`, REOPEN],
      confirmLabel: 'Remove desk',
      danger: true,
    },
    () => presetStore.closeDesk(id),
  );
}

export const deletePreset = (id: string, name: string) =>
  ifConfirmed(
    'Delete',
    {
      title: 'Delete preset',
      message: `Delete saved preset "${name}"? This cannot be undone.`,
      details: presetStore.isOpen(id)
        ? ['It is open as a desk: the desk is removed and its sockets close first.']
        : [],
      confirmLabel: 'Delete preset',
      danger: true,
    },
    () => presetStore.remove(id),
  );

export const saveDesk = () => runAction('Save', () => presetStore.save());

/** Asks where, then writes the active desk's preset file there. */
export const exportDesk = () =>
  exportJson('preset', presetStore.current.name, (path) => presetStore.exportTo(path));

/** Picks a preset file and opens it as a new desk. */
export const importAsDesk = () =>
  runAction('Import', async () => {
    const path = await open({ multiple: false, directory: false, filters: PRESET_FILES });
    if (typeof path !== 'string') return;
    const ok = await confirmAction({
      title: 'Import as new desk',
      message: `Import ${fileName(path)} and open it as a new desk?`,
      details: [STARTS_NOW],
      confirmLabel: 'Import & open',
    });
    if (!ok) return;
    await presetStore.importFile(path);
    toast(`Imported "${presetStore.current.name}" as a new desk`);
  });

/** Picks a preset file and replaces the active desk's contents with it. */
export const importIntoDesk = () =>
  runAction('Import', async () => {
    const path = await open({ multiple: false, directory: false, filters: PRESET_FILES });
    if (typeof path !== 'string') return;
    const desk = presetStore.current;
    const ok = await confirmAction({
      title: 'Import into this desk',
      message: `Replace desk "${desk.name}" with ${fileName(path)}?`,
      details: [
        `Its ${desk.widgets.length} widgets, grid and network settings are replaced by the file's.`,
        'Its outputs and inputs restart with the imported config.',
        'To keep this desk as it is, export it first, or use GLOBAL SETTINGS › LIBRARY › Import as new desk.',
        ...(sharedDesks.isLive(desk.id)
          ? ['This desk is shared: it is replaced for everyone in the session.']
          : []),
      ],
      confirmLabel: 'Replace desk',
      danger: true,
    });
    if (!ok) return;
    await presetStore.importInto(desk.id, path);
    toast(`Imported into "${presetStore.current.name}"`);
  });
