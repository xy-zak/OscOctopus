// LIBRARY's project actions (state/projects.svelte.ts), each asking first where it replaces or
// loses something, like deskActions.ts: save the setup, save over a project, load one, delete,
// export and import.
import { open } from '@tauri-apps/plugin-dialog';
import { projectStore } from '../lib/state/projects.svelte';
import { confirmAction, showDesk, toast } from '../lib/state/ui.svelte';
import { plural } from '../lib/util';
import { exportJson, ifConfirmed, jsonFiles, runAction } from './actions';

const list = (names: readonly string[]) =>
  names.length > 4
    ? `${names.slice(0, 4).join(', ')} and ${names.length - 4} more`
    : names.join(', ');

/** Saves the whole setup as a new project. */
export const saveProject = (name: string) =>
  runAction('Save project', async () => {
    await projectStore.save(name);
    toast(`Saved project "${name.trim()}"`);
  });

/** Replaces a saved project with the setup as it is now. */
export const saveOverProject = (id: string, name: string) =>
  ifConfirmed(
    'Save project',
    {
      title: 'Save over project',
      message: `Replace project "${name}" with the desks and look as they are now?`,
      details: ['Its earlier version is gone, unless you exported it.'],
      confirmLabel: 'Save over project',
      danger: true,
    },
    async () => {
      await projectStore.save(name, id);
      toast(`Saved project "${name}"`);
    },
  );

/** Loads a project, after saying what it replaces and closes. */
export const loadProject = (id: string, name: string) =>
  runAction('Load project', async () => {
    const plan = await projectStore.plan(id);
    const ok = await confirmAction({
      title: 'Load project',
      message: `Load "${name}": ${plural(plan.project.desks.length, 'desk')} and their look?`,
      details: [
        ...(plan.reset.length
          ? [`Reset to the project's version (changes since are lost): ${list(plan.reset)}.`]
          : []),
        ...(plan.copied.length
          ? [`Shared with a session, so they open as unshared copies: ${list(plan.copied)}.`]
          : []),
        ...(plan.closing.length
          ? [`Closed (they stay in the LIBRARY): ${list(plan.closing)}.`]
          : []),
        'Its desks start sending and listening at once.',
      ],
      confirmLabel: 'Load project',
      danger: plan.reset.length > 0,
    });
    if (!ok) return;
    const noRoom = await projectStore.restore(plan.project);
    showDesk('controls');
    toast(
      noRoom.length
        ? `Loaded project "${name}", but no room for its palettes ${list(noRoom)}: delete a custom palette in LOOK, then load it again`
        : `Loaded project "${name}"`,
      noRoom.length ? 'error' : undefined,
    );
  });

export const deleteProject = (id: string, name: string) =>
  ifConfirmed(
    'Delete',
    {
      title: 'Delete project',
      message: `Delete project "${name}"? This cannot be undone. Its desks stay in the LIBRARY.`,
      confirmLabel: 'Delete project',
      danger: true,
    },
    () => projectStore.remove(id),
  );

/** Asks where, then copies a project's file there. */
export const exportProject = (id: string, name: string) =>
  exportJson('project', name, (path) => projectStore.exportTo(id, path));

/** Picks a project file and adds it to the LIBRARY (loading it is up to the user). */
export const importProject = () =>
  runAction('Import', async () => {
    const path = await open({ multiple: false, directory: false, filters: jsonFiles('project') });
    if (typeof path !== 'string') return;
    const project = await projectStore.importFile(path);
    toast(`Added project "${project.name}" to the LIBRARY: Load it to use it`);
  });
