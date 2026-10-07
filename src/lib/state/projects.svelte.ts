// Projects (lib/model/project.ts): snapshots of the whole setup, saved by hand in GLOBAL
// SETTINGS › LIBRARY, apart from the desks' autosaved presets. Loading one restores it exactly:
// its desks open in its order (a desk that still exists is reset to the project's version, the
// open desks not in it close and stay in the LIBRARY), with its look, its custom palettes and
// its user skins. A desk shared with a sync session comes back as an unshared copy instead, so
// loading a project never rewrites a shared desk for the other devices.
import { projects as projectIpc, sync as syncIpc } from '../ipc/commands';
import type { ProjectSummary } from '../ipc/types';
import { withFreshWidgetIds } from '../model/factory';
import { uid } from '../model/parts';
import type { Preset } from '../model/preset';
import { buildProject, parseProject, type Project } from '../model/project';
import { appearance } from './appearance.svelte';
import { lookStore } from './look.svelte';
import { presetStore } from './preset.svelte';
import { skinStore } from './skins.svelte';

/** What loading a project will do, so the user can be asked first. */
export interface RestorePlan {
  project: Project;
  /** Saved desks it resets to its own version (by name). */
  reset: string[];
  /** Shared desks it opens as unshared copies (by name). */
  copied: string[];
  /** Open desks that close (they stay in the LIBRARY). */
  closing: string[];
}

class ProjectStore {
  summaries: ProjectSummary[] = $state.raw([]);

  async refresh() {
    this.summaries = await projectIpc.list();
  }

  /** Saves the whole setup as a project; with `id`, replaces that project. */
  async save(name: string, id: string = uid('proj')) {
    await presetStore.flushAll();
    const file = buildProject({
      id,
      name,
      desks: presetStore.desks.map((d) => presetStore.snapshot(d.id)),
      activeDesk: presetStore.activeId,
      look: $state.snapshot(lookStore.setting),
      theme: $state.snapshot(appearance.theme),
      userSkins: skinStore.user,
    });
    await projectIpc.save(file);
    await this.refresh();
  }

  async remove(id: string) {
    await projectIpc.remove(id);
    await this.refresh();
  }

  exportTo(id: string, path: string): Promise<void> {
    return projectIpc.exportTo(id, path);
  }

  /**
   * Adds a project file to the LIBRARY (loading it is a separate step). One whose id is taken
   * here comes in under a new id, so nothing saved is replaced.
   */
  async importFile(path: string): Promise<Project> {
    const raw = await projectIpc.readFile(path);
    const project = parseProject(raw);
    const taken = this.summaries.some((s) => s.id === project.id);
    const id = taken ? uid('proj') : project.id;
    await projectIpc.save({ ...(raw as object), id });
    await this.refresh();
    return { ...project, id };
  }

  /** Reads a saved project and works out what loading it will do. */
  async plan(id: string): Promise<RestorePlan> {
    const project = parseProject(await projectIpc.load(id));
    const saved = new Set(presetStore.summaries.filter((s) => !s.error).map((s) => s.id));
    const reset: string[] = [];
    const copied: string[] = [];
    for (const d of project.desks) {
      if (await isShared(d.id)) copied.push(d.name);
      else if (saved.has(d.id)) reset.push(d.name);
    }
    const ids = new Set(project.desks.map((d) => d.id));
    const closing = presetStore.desks.filter((d) => !ids.has(d.id)).map((d) => d.name);
    return { project, reset, copied, closing };
  }

  /**
   * Loads a project (after `plan`, and the user's yes). Resolves with the custom palettes that
   * had no room here (LIMITS.customPalettes): desks wearing one show RAINBOW instead.
   */
  async restore(project: Project): Promise<string[]> {
    // What the look names first, so the desks never show a palette or skin that isn't there.
    const noRoom: string[] = [];
    for (const p of project.theme.custom)
      if (!(await appearance.saveCustom(p))) noRoom.push(p.name);
    for (const s of project.skins) await skinStore.saveUser(s);
    await appearance.set({ mode: project.theme.mode });

    const renamed = new Map<string, string>();
    const desks: Preset[] = [];
    for (const d of project.desks) {
      if (await isShared(d.id)) {
        const copy = withFreshWidgetIds(structuredClone(d));
        copy.id = uid('p');
        renamed.set(d.id, copy.id);
        desks.push(copy);
      } else desks.push(d);
    }
    const active = project.activeDesk
      ? (renamed.get(project.activeDesk) ?? project.activeDesk)
      : null;
    await presetStore.restoreWorkspace(desks, active);
    await lookStore.restore(
      project.look,
      project.desks.map((d) => d.id),
      renamed,
    );
    return noRoom;
  }
}

/** Whether a desk is shared with a sync session here (it has a sync record). */
async function isShared(deskId: string): Promise<boolean> {
  try {
    return (await syncIpc.docLoad(deskId)) !== null;
  } catch {
    return false;
  }
}

export const projectStore = new ProjectStore();
