// The workspace: every open desk is a preset (layout, widgets, network config), shown
// as a tab. All open desks' networks run at the same time; editing always happens on the
// active desk (`current`). Every mutation goes through `touch()`, which marks the desk dirty,
// autosaves it (see autosave.svelte.ts), and (for network edits) re-applies that desk's
// network config.
import { presets as presetIpc } from '../ipc/commands';
import type { PresetSummary } from '../ipc/types';
import {
  collisions,
  editCell,
  findFreeSpot,
  outOfBounds,
  withEditCell,
  type Rect,
} from '../grid/engine';
import { newInput, newOutput, newPreset, withFreshWidgetIds } from '../model/factory';
import { migratePreset } from '../model/migrations';
import { uid } from '../model/parts';
import {
  PresetSchema,
  type Grid,
  type Preset,
  type Widget,
  type WidgetType,
} from '../model/preset';
import { getSetting } from '../platform/settings';
import { PALETTE_SIZE } from '../theme/palettes';
import { errorText } from '../util';
import { DEFS, initialValue, newWidget } from '../widgets/defs';
import { appearance } from './appearance.svelte';
import { Autosave } from './autosave.svelte';
import { networkStore } from './network.svelte';
import { persistSetting } from './persist';
import { toast, ui } from './ui.svelte';
import { values } from './values.svelte';

const AUTOSAVE_MS = 600;

class PresetStore {
  /** Open desks, in tab order. Always at least one once initialised. */
  desks: Preset[] = $state([]);
  activeId = $state('');
  summaries: PresetSummary[] = $state.raw([]);
  dir = $state('');
  lastSavedAt: number | null = $state(null);
  saveError: string | null = $state(null);

  private savesInFlight = $state(0);
  private autosave = new Autosave((id) => this.writeDesk(id), AUTOSAVE_MS);
  private initialised: Promise<void> | null = null;
  /** A pre-v4 preset's per-desk theme, used once to seed the global palette. */
  private legacyTheme: unknown;

  /** The active desk. Everything that edits (Inspector, Network, Presets) works on this. */
  get current(): Preset {
    return this.desks.find((d) => d.id === this.activeId) ?? this.desks[0] ?? this.placeholder;
  }
  private placeholder = newPreset('…');

  get saving(): boolean {
    return this.savesInFlight > 0;
  }

  /** Whether the active desk has unsaved changes. */
  get dirty(): boolean {
    return this.isDirty(this.current.id);
  }

  isDirty(id: string): boolean {
    return !!this.autosave.dirty[id];
  }

  isOpen(id: string): boolean {
    return this.desks.some((d) => d.id === id);
  }

  /** Idempotent: a remount (hot reload, webview reload) must not open desks twice. */
  init(): Promise<void> {
    this.initialised ??= this.doInit();
    return this.initialised;
  }

  private async doInit() {
    try {
      this.dir = await presetIpc.dir();
      await this.refreshList();
      const valid = (id: string) => this.summaries.some((s) => s.id === id && !s.error);
      const saved = (await getSetting('openDesks')) ?? [];
      const legacy = await getSetting('lastPresetId');
      const wanted = [...new Set(saved.length ? saved : legacy ? [legacy] : [])].filter(valid);
      for (const id of wanted) {
        try {
          this.register(await this.loadPreset(id));
        } catch (e) {
          toast(`Could not open desk ${id}: ${errorText(e)}`, 'error');
        }
      }
      if (this.desks.length === 0) {
        const first = this.summaries.find((s) => !s.error);
        if (first) this.register(await this.loadPreset(first.id));
      }
    } catch (e) {
      toast(`Could not open presets: ${errorText(e)}`, 'error');
    }
    if (this.desks.length === 0) {
      // First run (or nothing loadable): start from the default desk and save it.
      const p = newPreset();
      await this.writePreset(p);
      this.register(p);
    }
    await appearance.load(this.legacyTheme);
    const active = await getSetting('activeDesk');
    this.activeId = active && this.isOpen(active) ? active : this.desks[0]!.id;
    await Promise.all(this.desks.map((d) => networkStore.apply(d.id, this.snapshot(d.id).network)));
    await this.persistOpen();
  }

  snapshot(id = this.current.id): Preset {
    const desk = this.desks.find((d) => d.id === id) ?? this.current;
    return $state.snapshot(desk) as Preset;
  }

  async refreshList() {
    this.summaries = await presetIpc.list();
  }

  private async loadPreset(id: string): Promise<Preset> {
    const raw = await presetIpc.load(id);
    this.legacyTheme ??= (raw as { theme?: unknown } | null)?.theme;
    return migratePreset(raw);
  }

  /**
   * Adds a desk to the workspace. Widget ids must be unique across open desks (live values
   * are keyed by widget id), so a desk whose ids collide with an open one gets fresh ids
   * (and is saved with them).
   */
  private register(preset: Preset): Preset {
    const open = this.desks.find((d) => d.id === preset.id);
    if (open) return open;
    const taken = new Set(this.desks.flatMap((d) => d.widgets.map((w) => w.id)));
    const collides = preset.widgets.some((w) => taken.has(w.id));
    if (collides) preset = withFreshWidgetIds(preset);
    this.desks.push(preset);
    for (const w of preset.widgets) values[w.id] = initialValue(w);
    if (collides) this.autosave.touch(preset.id);
    return preset;
  }

  private async persistOpen() {
    await persistSetting(
      'openDesks',
      this.desks.map((d) => d.id),
    );
    await persistSetting('activeDesk', this.activeId);
  }

  activate(id: string) {
    if (!this.isOpen(id) || id === this.activeId) return;
    this.activeId = id;
    ui.selectedId = ui.focusedId = null;
    void this.persistOpen();
  }

  /** Opens a saved preset as a new desk tab (or switches to it if already open). */
  async openDesk(id: string) {
    if (this.isOpen(id)) return this.activate(id);
    const p = this.register(await this.loadPreset(id));
    await networkStore.apply(p.id, this.snapshot(p.id).network);
    this.activate(p.id);
  }

  /** First identity colour not used by an open desk, so tabs stay distinguishable. */
  nextDeskColor(): number {
    const used = new Set(this.desks.map((d) => d.color));
    for (let i = 0; i < PALETTE_SIZE; i++) if (!used.has(i)) return i;
    return this.desks.length % PALETTE_SIZE;
  }

  async newDesk(name: string) {
    const p = newPreset(name, { loopbackInput: false, color: this.nextDeskColor() });
    await this.writePreset(p);
    this.register(p);
    await networkStore.apply(p.id, this.snapshot(p.id).network);
    this.activate(p.id);
  }

  /** Copies the active desk into a new preset and opens it as a new tab. */
  async duplicateDesk(name: string) {
    const copy = withFreshWidgetIds(this.snapshot());
    copy.id = uid('p');
    copy.name = name;
    copy.color = this.nextDeskColor();
    copy.createdAt = copy.updatedAt = new Date().toISOString();
    await this.writePreset(copy);
    this.register(copy);
    await networkStore.apply(copy.id, this.snapshot(copy.id).network);
    this.activate(copy.id);
  }

  /** Closes a desk tab: saves it, stops its sockets. The preset file stays. */
  async closeDesk(id: string): Promise<boolean> {
    const i = this.desks.findIndex((d) => d.id === id);
    if (i < 0 || this.desks.length <= 1) return false;
    await this.autosave.flush(id);
    await networkStore.closeDesk(id);
    for (const w of this.desks[i]!.widgets) delete values[w.id];
    this.desks.splice(i, 1);
    this.autosave.forget(id);
    if (this.activeId === id) {
      this.activeId = this.desks[Math.min(i, this.desks.length - 1)]!.id;
      ui.selectedId = ui.focusedId = null;
    }
    await this.persistOpen();
    return true;
  }

  /** Marks the active desk changed. Pass `network: true` when its network config changed. */
  touch(opts: { network?: boolean } = {}) {
    const desk = this.current;
    desk.updatedAt = new Date().toISOString();
    this.autosave.touch(desk.id);
    if (opts.network) networkStore.scheduleApply(desk.id, () => this.snapshot(desk.id).network);
  }

  /** Saves a desk now (after any save of it already in progress). */
  save(id = this.current.id): Promise<void> {
    return this.autosave.save(id);
  }

  /** Writes every pending change of every desk (before the app closes or is backgrounded). */
  flushAll(): Promise<void> {
    return this.autosave.flushAll();
  }

  /** Validates and writes a preset that is not (yet) open. */
  private async writePreset(p: Preset) {
    PresetSchema.parse(p);
    await presetIpc.save(p);
    await this.refreshList();
  }

  /** The autosave's writer: validates, then writes one open desk. */
  private async writeDesk(id: string): Promise<boolean> {
    if (!this.isOpen(id)) return false;
    const snap = this.snapshot(id);
    // Validate before writing: an editor bug must never corrupt a saved preset.
    const check = PresetSchema.safeParse(snap);
    if (!check.success) {
      const issue = check.error.issues[0];
      this.saveError = `${snap.name} not saved: ${issue?.path.join('.')}: ${issue?.message}`;
      return false;
    }
    this.savesInFlight++;
    try {
      await presetIpc.save(snap);
      this.saveError = null;
      this.lastSavedAt = Date.now();
      await this.refreshList();
      return true;
    } catch (e) {
      this.saveError = errorText(e);
      return false;
    } finally {
      this.savesInFlight--;
    }
  }

  /** Deletes a preset file; closes its desk first if it is open. */
  async remove(id: string) {
    if (this.isOpen(id)) {
      if (this.desks.length <= 1) await this.newDesk('My desk');
      await this.closeDesk(id);
    }
    await presetIpc.remove(id);
    await this.refreshList();
  }

  async importFile(path: string) {
    let preset = migratePreset(await presetIpc.readFile(path));
    if (this.summaries.some((s) => s.id === preset.id)) {
      preset = withFreshWidgetIds(preset);
      preset.id = uid('p');
    }
    await this.writePreset(preset);
    await this.openDesk(preset.id);
  }

  /**
   * Replaces a desk's contents with a preset file, in place: the desk keeps its id (and tab),
   * its network restarts with the imported config, and it is saved.
   */
  async importInto(deskId: string, path: string) {
    const i = this.desks.findIndex((d) => d.id === deskId);
    if (i < 0) throw new Error('desk is not open');
    let incoming = migratePreset(await presetIpc.readFile(path));
    const others = new Set(
      this.desks.filter((d) => d.id !== deskId).flatMap((d) => d.widgets.map((w) => w.id)),
    );
    if (incoming.widgets.some((w) => others.has(w.id))) incoming = withFreshWidgetIds(incoming);
    const old = this.desks[i]!;
    for (const w of old.widgets) delete values[w.id];
    const replaced: Preset = {
      ...incoming,
      id: old.id,
      color: old.color, // the desk keeps its identity
      createdAt: old.createdAt,
      updatedAt: new Date().toISOString(),
    };
    this.desks[i] = replaced;
    for (const w of replaced.widgets) values[w.id] = initialValue(w);
    if (this.activeId === deskId) ui.selectedId = ui.focusedId = null;
    await networkStore.apply(deskId, this.snapshot(deskId).network);
    this.autosave.touch(deskId);
    await this.autosave.save(deskId);
  }

  async exportTo(path: string) {
    await this.save();
    await presetIpc.exportTo(this.current.id, path);
  }

  // ---- network endpoints (active desk) --------------------------------------------------
  // Created here (not in components) so the objects belong to the store, and the cards that
  // edit them aren't mutating another component's state.

  /** New endpoints start as UDP; transport is picked in the endpoint's card. */
  addOutput() {
    const n = this.current.network.outputs.length + 1;
    this.current.network.outputs.push(newOutput({ name: `Output ${n}` }));
    this.touch({ network: true });
  }

  addInput() {
    const n = this.current.network.inputs.length + 1;
    this.current.network.inputs.push(newInput({ name: `Input ${n}` }));
    this.touch({ network: true });
  }

  /** Number of widget messages that send to an output. */
  outputUsage(outputId: string): number {
    return this.current.widgets.reduce(
      (n, w) => n + w.bindings.filter((b) => b.outputIds.includes(outputId)).length,
      0,
    );
  }

  /** Removes an output and every reference to it from widget messages. */
  removeOutput(id: string) {
    for (const w of this.current.widgets)
      for (const b of w.bindings) b.outputIds = b.outputIds.filter((o) => o !== id);
    this.current.network.outputs = this.current.network.outputs.filter((o) => o.id !== id);
    this.touch({ network: true });
  }

  removeInput(id: string) {
    this.current.network.inputs = this.current.network.inputs.filter((i) => i.id !== id);
    this.touch({ network: true });
  }

  // ---- widgets --------------------------------------------------------------------------

  /** A widget of the active desk. */
  widget(id: string | null): Widget | undefined {
    return id ? this.current.widgets.find((w) => w.id === id) : undefined;
  }

  /** A widget of any open desk, with its desk (used when sending). */
  findWidget(id: string): { desk: Preset; widget: Widget } | undefined {
    for (const desk of this.desks) {
      const widget = desk.widgets.find((w) => w.id === id);
      if (widget) return { desk, widget };
    }
    return undefined;
  }

  addWidget(type: WidgetType) {
    const { grid, widgets } = this.current;
    const spot = findFreeSpot(DEFS[type].defaultSize, grid, withEditCell(widgets, grid));
    if (!spot) {
      toast('No free space on the grid: resize the grid or remove a widget', 'error');
      return;
    }
    const firstOutput = this.current.network.outputs[0]?.id;
    const n = this.current.widgets.filter((w) => w.type === type).length + 1;
    const w = newWidget(type, spot, firstOutput ? [firstOutput] : [], n);
    this.current.widgets.push(w);
    values[w.id] = initialValue(w);
    ui.selectedId = w.id;
    this.touch();
  }

  duplicateWidget(id: string) {
    const src = this.widget(id);
    if (!src) return;
    const { grid, widgets } = this.current;
    const spot = findFreeSpot({ w: src.w, h: src.h }, grid, withEditCell(widgets, grid));
    if (!spot) {
      toast('No free space for a copy of this size', 'error');
      return;
    }
    const copy = $state.snapshot(src) as Widget;
    copy.id = uid('w');
    Object.assign(copy, spot);
    copy.bindings.forEach((b) => (b.id = uid('b')));
    this.current.widgets.push(copy);
    values[copy.id] = initialValue(copy);
    ui.selectedId = copy.id;
    this.touch();
  }

  removeWidget(id: string) {
    this.current.widgets = this.current.widgets.filter((w) => w.id !== id);
    delete values[id];
    if (ui.selectedId === id) ui.selectedId = null;
    if (ui.focusedId === id) ui.focusedId = null;
    this.touch();
  }

  setRect(id: string, rect: Rect) {
    const w = this.widget(id);
    if (!w) return;
    Object.assign(w, rect);
    this.touch();
  }

  /** Refuses to shrink the grid under existing widgets instead of silently moving them. */
  setGrid(patch: Partial<Grid>): boolean {
    const next = { ...this.current.grid, ...patch };
    const clipped = outOfBounds(this.current.widgets, next);
    if (clipped.length) {
      toast(
        `${clipped.length} widget(s) would fall outside a ${next.cols}×${next.rows} grid; move them first`,
        'error',
      );
      return false;
    }
    // The top-right cells are the EDIT / LIVE switch's, and they move with the right edge.
    if (collisions(editCell(next), this.current.widgets).length) {
      toast(
        `A widget sits in the top-right cells of a ${next.cols}-column grid, where the EDIT / LIVE switch goes; move it first`,
        'error',
      );
      return false;
    }
    this.current.grid = next;
    this.touch();
    return true;
  }
}

export const presetStore = new PresetStore();
