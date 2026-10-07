// A project: a snapshot of the whole setup, saved by hand (GLOBAL SETTINGS › LIBRARY) and kept
// apart from the desks' own autosaved presets. It holds the open desks in tab order (each a
// full preset, with its network), which one was shown, and the look: every desk's and each of
// these desks' palette, ACTIVE colour and skin, dark or light, and the custom palettes and user
// skins that look uses, so a project looks the same on another device. Never the device's own
// state: sync identity, keys and peers, OSC-IN / OSC-OUT / FREEZE.
//
// Rust stores it as opaque JSON (src-tauri/src/projects.rs, which checks the desks are valid
// presets). Each desk keeps its own schemaVersion and migrates on load like any preset, so the
// envelope only changes (PROJECT_VERSION) when its own fields do. Pure; tested in
// project.test.ts.
import { z } from 'zod';
import { SkinSchema, type Skin } from '../skins/schema';
import { LookSettingSchema, type LookSetting } from '../theme/look';
import { migratePreset } from './migrations';
import { IdSchema, ThemeSchema, type Preset, type Theme } from './preset';

export const PROJECT_FORMAT = 'oscoctopus-project';
export const PROJECT_VERSION = 1;
export const PROJECT_NAME = { min: 1, max: 64 } as const;

export const ProjectFileSchema = z.object({
  format: z.literal(PROJECT_FORMAT),
  version: z.number().int(),
  id: IdSchema,
  name: z.string().trim().min(PROJECT_NAME.min).max(PROJECT_NAME.max),
  savedAt: z.string(),
  /** Presets, as saved (each migrated on load). */
  desks: z.array(z.unknown()).min(1),
  activeDesk: IdSchema.nullable(),
  look: LookSettingSchema,
  /** Dark or light, and the custom palettes the look uses. */
  theme: ThemeSchema,
  /** The user skins the look uses. */
  skins: z.array(z.unknown()),
});
export type ProjectFile = z.infer<typeof ProjectFileSchema>;

/** A project read back: its desks migrated to today's schema, its skins checked. */
export interface Project {
  id: string;
  name: string;
  savedAt: string;
  desks: Preset[];
  activeDesk: string | null;
  look: LookSetting;
  theme: Theme;
  skins: Skin[];
}

export class ProjectError extends Error {}

/** What a project captures, from the app's state. */
export interface ProjectSource {
  id: string;
  name: string;
  /** The open desks, in tab order. */
  desks: Preset[];
  activeDesk: string | null;
  look: LookSetting;
  theme: Theme;
  userSkins: readonly Skin[];
  now?: Date;
}

/**
 * The file for a project: the look trimmed to every desk's and these desks' choices, and only
 * the custom palettes and user skins those choices name.
 */
export function buildProject(src: ProjectSource): ProjectFile {
  const ids = new Set(src.desks.map((d) => d.id));
  const desks = Object.fromEntries(Object.entries(src.look.desks).filter(([id]) => ids.has(id)));
  const chosen = [src.look.global, ...Object.values(desks)];
  const palettes = new Set(chosen.map((l) => l.palette).filter(Boolean));
  const skins = new Set(chosen.map((l) => l.skin).filter(Boolean));
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    id: src.id,
    name: src.name.trim(),
    savedAt: (src.now ?? new Date()).toISOString(),
    desks: src.desks,
    activeDesk: src.activeDesk && ids.has(src.activeDesk) ? src.activeDesk : null,
    look: { global: { ...src.look.global }, desks },
    theme: { mode: src.theme.mode, custom: src.theme.custom.filter((p) => palettes.has(p.id)) },
    skins: src.userSkins.filter((s) => skins.has(s.id)),
  };
}

const issue = (e: z.ZodError) => {
  const i = e.issues[0];
  return i ? `${i.path.join('.') || '(root)'}: ${i.message}` : 'invalid';
};

/** Reads a project file: checks it, migrates its desks, checks its skins. Throws ProjectError. */
export function parseProject(raw: unknown): Project {
  const envelope = ProjectFileSchema.safeParse(raw);
  if (!envelope.success) throw new ProjectError(`not a project: ${issue(envelope.error)}`);
  const file = envelope.data;
  if (file.version > PROJECT_VERSION)
    throw new ProjectError(
      `made by a newer OscOctopus (project v${file.version}; this app reads up to v${PROJECT_VERSION}): update the app`,
    );
  const desks = file.desks.map((d, i) => {
    try {
      return migratePreset(d);
    } catch (e) {
      throw new ProjectError(`desk ${i + 1} can't be opened: ${(e as Error).message}`);
    }
  });
  if (new Set(desks.map((d) => d.id)).size < desks.length)
    throw new ProjectError('it holds the same desk twice');
  const skins = file.skins.map((s, i) => {
    const parsed = SkinSchema.safeParse(s);
    if (!parsed.success) throw new ProjectError(`skin ${i + 1}: ${issue(parsed.error)}`);
    return parsed.data;
  });
  return {
    id: file.id,
    name: file.name,
    savedAt: file.savedAt,
    desks,
    activeDesk: file.activeDesk,
    look: file.look,
    theme: file.theme,
    skins,
  };
}
