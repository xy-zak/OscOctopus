/**
 * Navigation is two-level and scoped by containment:
 * - `view` picks the container: the active desk, or GLOBAL SETTINGS (things that belong to no
 *   desk).
 * - each container has its own sections. Ids are the lower-case UI labels. NETWORK, TRAFFIC
 *   and SYNC exist in both containers; the frame colour tells them apart on screen.
 */
export type View = 'desk' | 'global';
/** Sections of a desk. */
export type DeskView = 'controls' | 'network' | 'traffic' | 'preset' | 'sync';
/** Sections of GLOBAL SETTINGS. */
export type GlobalView = 'network' | 'traffic' | 'library' | 'look' | 'sync';
export type Mode = 'live' | 'edit';
/** The Inspector's foldable sections (edit mode), in order. */
export type InspectorSection = 'visual' | 'interaction' | 'messages' | 'activity';
/** The live-mode info panel's foldable sections, in order. */
export type InfoSection = 'value' | 'messages' | 'activity';

export interface Section<Id extends string> {
  id: Id;
  label: string;
  hint: string;
}

/** In F-key order (F1…F5). */
export const DESK_SECTIONS: readonly Section<DeskView>[] = [
  { id: 'controls', label: 'CONTROLS', hint: 'This desk’s widgets: play them, or EDIT them' },
  { id: 'network', label: 'NETWORK', hint: 'This desk’s OSC outputs and inputs' },
  { id: 'traffic', label: 'TRAFFIC', hint: 'Traffic of this desk only' },
  { id: 'preset', label: 'PRESET', hint: 'This desk’s name, colour and preset file' },
  { id: 'sync', label: 'SYNC', hint: 'Share this desk live with the sync session' },
];

/** In F-key order (F1…F5). */
export const GLOBAL_SECTIONS: readonly Section<GlobalView>[] = [
  { id: 'network', label: 'NETWORK', hint: 'This device’s interfaces, and every desk’s endpoints' },
  { id: 'traffic', label: 'TRAFFIC', hint: 'Traffic of all desks together' },
  { id: 'library', label: 'LIBRARY', hint: 'All saved desk presets on this device' },
  { id: 'look', label: 'LOOK', hint: 'Background, palette and widget skin, for every desk' },
  { id: 'sync', label: 'SYNC', hint: 'Share desks live with other OscOctopus devices' },
];

export const ui = $state({
  view: 'desk' as View,
  deskView: 'controls' as DeskView,
  globalView: 'network' as GlobalView,
  mode: 'live' as Mode,
  /** Edit mode: the widget open in the Inspector. */
  selectedId: null as string | null,
  /** Live mode: the widget touched last, shown in the info panel. */
  focusedId: null as string | null,
  /** Live mode: whether the read-only info panel is shown. */
  infoOpen: true,
  /** Live mode: which info panel sections are unfolded (remembered per device once toggled). */
  infoSections: { value: true, messages: true, activity: true } as Record<InfoSection, boolean>,
  /** Edit mode: which Inspector sections are unfolded (remembered per device once toggled). */
  inspectorOpen: { visual: true, interaction: true, messages: true, activity: false } as Record<
    InspectorSection,
    boolean
  >,
  /**
   * LOCK: everything is frozen for a show: widgets ignore input, no edit mode, network and
   * presets are read-only, desks can't be added or removed. Still usable: viewing, switching
   * views and desk tabs, and OSC-OUT (a safety control).
   */
  locked: false,
  /**
   * PRESENTING: the active desk's widgets fill the screen, live. Only the desk tabs and the
   * master switches (OSC-IN, OSC-OUT, LOCK, PRESENT to stop) stay; the sections, the desk's
   * tool row, the side panel and the banners are hidden, and nothing can navigate away from
   * the widgets (see `setPresenting`).
   */
  presenting: false,
  /** Bumped when something locked is touched, so the LOCK button can hint how to unlock. */
  lockNudge: 0,
  /** The confirm dialog currently shown, if any. */
  confirm: null as ConfirmRequest | null,
  toast: null as { id: number; text: string; kind: 'info' | 'error' } | null,
});

let toastId = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

/** Brief notification. Errors stay up longer so they can actually be read. */
export function toast(text: string, kind: 'info' | 'error' = 'info') {
  ui.toast = { id: ++toastId, text, kind };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (ui.toast = null), kind === 'error' ? 8000 : 2500);
}

export interface ConfirmRequest {
  title: string;
  message: string;
  /** Extra detail lines, shown dimmed. */
  details?: string[];
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
}

/**
 * In-app confirmation (TUI styled, works the same on desktop and mobile). Resolves true only
 * if the user explicitly confirms; Esc, cancel and clicking outside all resolve false.
 */
export function confirmAction(opts: {
  title: string;
  message: string;
  details?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  ui.confirm?.resolve(false);
  return new Promise((resolve) => {
    ui.confirm = {
      title: opts.title,
      message: opts.message,
      details: opts.details,
      confirmLabel: opts.confirmLabel ?? 'Confirm',
      cancelLabel: opts.cancelLabel ?? 'Cancel',
      danger: opts.danger ?? false,
      resolve: (ok) => {
        ui.confirm = null;
        resolve(ok);
      },
    };
  });
}

/** Locks or unlocks. Locking ends any edit in progress: edit mode and an open confirmation. */
export function setLocked(locked: boolean) {
  ui.locked = locked;
  if (!locked) return;
  ui.mode = 'live';
  ui.selectedId = null;
  ui.confirm?.resolve(false);
}

/** Live ⇄ edit on the desk surface. Refused while LOCKED or PRESENTING. */
export function toggleEditMode() {
  if (ui.locked || ui.presenting) return;
  ui.mode = ui.mode === 'live' ? 'edit' : 'live';
  if (ui.mode === 'live') ui.selectedId = null;
  else ui.deskView = 'controls';
}

/**
 * Enters or leaves PRESENTING. Entering shows the active desk's widgets, live. While it lasts,
 * only desk tabs can change what is on screen: every other way to navigate is refused.
 */
export function setPresenting(on: boolean) {
  ui.presenting = on;
  if (!on) return;
  ui.view = 'desk';
  ui.deskView = 'controls';
  ui.mode = 'live';
  ui.selectedId = null;
}

/** Go to a section of the active desk. Only CONTROLS while PRESENTING. */
export function showDesk(section: DeskView = ui.deskView) {
  if (ui.presenting && section !== 'controls') return;
  ui.view = 'desk';
  ui.deskView = section;
}

/** Go to a GLOBAL SETTINGS section. Refused while PRESENTING. */
export function showGlobal(section: GlobalView = ui.globalView) {
  if (ui.presenting) return;
  ui.view = 'global';
  ui.globalView = section;
}

/** The sections of the container on screen. */
export function currentSections(): readonly Section<DeskView | GlobalView>[] {
  return ui.view === 'desk' ? DESK_SECTIONS : GLOBAL_SECTIONS;
}

/** The section shown in the container on screen. */
export function currentSection(): DeskView | GlobalView {
  return ui.view === 'desk' ? ui.deskView : ui.globalView;
}

/** Shows section `i` (F1 = 0) of the container on screen. Refused while PRESENTING. */
export function showSectionAt(i: number) {
  if (ui.presenting) return;
  if (ui.view === 'desk') {
    const s = DESK_SECTIONS[i];
    if (s) ui.deskView = s.id;
  } else {
    const s = GLOBAL_SECTIONS[i];
    if (s) ui.globalView = s.id;
  }
}
