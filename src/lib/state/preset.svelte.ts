// The workspace: every open desk is a preset (layout, widgets, network config), shown
// as a tab. All open desks' networks run at the same time; editing always happens on the
// active desk (`current`). Every change of any desk ends in `changed()`, which autosaves it
// (see autosave.svelte.ts), re-applies its network config when endpoints changed, and tells
// sync (state/changes.ts). `touch()` is `changed()` for the active desk.
import { presets as presetIpc, sync as syncIpc } from '../ipc/commands';
import type { PresetSummary } from '../ipc/types';
import {
  allFree,
  findFreeSpot,
  findRoom,
  isFree,
  outOfBounds,
  type Placed,
  type Rect,
} from '../grid/engine';
import { freshCopies, newInput, newOutput, newPreset, withFreshWidgetIds } from '../model/factory';
import { migratePreset } from '../model/migrations';
import { uid } from '../model/parts';
import {
  PresetSchema,
  type Grid,
  type Preset,
  type TabRef,
  type Widget,
  type WidgetType,
} from '../model/preset';
import {
  canHold,
  canPlace,
  childrenOf,
  gridOn,
  isTabs,
  placements,
  sameTab,
  widgetsOn,
} from '../model/tabs';
import { getSetting } from '../platform/settings';
import { patchInPlace } from '../sync/reconcile';
import { PALETTE_SIZE } from '../theme/palettes';
import { errorText } from '../util';
import { DEFS, dropOutputFrom, initialValue, newWidget, outputRefsOf } from '../widgets/defs';
import { newTab, shownTab, tabsFull, TOO_MANY_TABS } from '../widgets/tabs/def';
import { appearance } from './appearance.svelte';
import { Autosave } from './autosave.svelte';
import { deskChanges, syncKey, syncRecords } from './changes';
import { debugStore } from './debug.svelte';
import { forgetFeedback } from './feedback.svelte';
import { inputStore } from './input.svelte';
import { lookStore } from './look.svelte';
import { networkStore } from './network.svelte';
import { persistSetting } from './persist';
import { endEdit, toast, ui } from './ui.svelte';
import { values } from './values.svelte';

const AUTOSAVE_MS = 600;
const NO_ROOM = 'No free space on the grid: resize the grid or remove a widget';

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
    // The look first: it carries over the palette the theme used to hold.
    await lookStore.load(this.legacyTheme);
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
    if (collides) this.changed(preset.id);
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
    // Another desk's CONTROLS open LIVE, like coming back to a section (ui.svelte.ts › endEdit).
    endEdit();
    ui.focusedId = null;
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

  /** Copies a desk (the active one by default) into a new preset and opens it as a new tab. */
  async duplicateDesk(name: string, sourceId = this.current.id) {
    const copy = withFreshWidgetIds(this.snapshot(sourceId));
    copy.id = uid('p');
    copy.name = name;
    copy.color = this.nextDeskColor();
    copy.createdAt = copy.updatedAt = new Date().toISOString();
    await this.writePreset(copy);
    await lookStore.copyDesk(sourceId, copy.id);
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
    for (const w of this.desks[i]!.widgets) forgetWidget(w.id);
    this.desks.splice(i, 1);
    this.autosave.forget(id);
    if (this.activeId === id) {
      this.activeId = this.desks[Math.min(i, this.desks.length - 1)]!.id;
      ui.selected = [];
      ui.focusedId = null;
    }
    await this.persistOpen();
    return true;
  }

  /**
   * A desk's contents changed; every change path ends here. It autosaves, re-applies the
   * network when `network` is set, and tells sync. `origin: 'remote'` marks changes that came
   * from sync (never shared again). `deleted` names what this change removed on purpose (sync
   * keys, see `syncKey`): sync never infers a deletion from a missing widget.
   */
  changed(
    deskId: string,
    opts: { network?: boolean; origin?: 'local' | 'remote'; deleted?: string[] } = {},
  ) {
    const desk = this.desks.find((d) => d.id === deskId);
    if (!desk) return;
    desk.updatedAt = new Date().toISOString();
    this.autosave.touch(deskId);
    if (opts.network) networkStore.scheduleApply(deskId, () => this.snapshot(deskId).network);
    deskChanges.emit({ deskId, origin: opts.origin ?? 'local', deleted: opts.deleted });
  }

  /** Marks the active desk changed (see `changed`). */
  touch(opts: { network?: boolean; deleted?: string[] } = {}) {
    this.changed(this.current.id, opts);
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
      // A shared desk is saved with its sync record (record first, see sync/docs.rs).
      const record = syncRecords.of(id);
      if (record) await syncIpc.deskSave(snap, record);
      else await presetIpc.save(snap);
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

  /**
   * Opens a desk that came from sync peers (a shared desk joined from the session). Peers
   * address widgets by id, so its ids are kept: a clash with an open desk is refused.
   */
  async adopt(preset: Preset) {
    PresetSchema.parse(preset);
    if (this.isOpen(preset.id)) throw new Error('a desk with this id is already open');
    const taken = new Set(this.desks.flatMap((d) => d.widgets.map((w) => w.id)));
    if (preset.widgets.some((w) => taken.has(w.id)))
      throw new Error('its widgets clash with an open desk; close that desk first');
    this.desks.push(preset);
    for (const w of preset.widgets) values[w.id] = initialValue(w);
    await this.autosave.save(preset.id);
    await networkStore.apply(preset.id, this.snapshot(preset.id).network);
    this.activate(preset.id);
  }

  /**
   * Applies a desk as merged by sync, in place (see sync/reconcile.ts): only what differs
   * changes, and open editors stay attached. Marked `remote`, so it is never shared again.
   */
  applyRemote(deskId: string, next: Preset, network: boolean) {
    const desk = this.desks.find((d) => d.id === deskId);
    if (!desk) return;
    const before = new Set(desk.widgets.map((w) => w.id));
    patchInPlace(desk, next);
    const after = new Set(desk.widgets.map((w) => w.id));
    for (const w of desk.widgets) if (!before.has(w.id)) values[w.id] = initialValue(w);
    for (const id of before) {
      if (after.has(id)) continue;
      forgetWidget(id);
      if (ui.focusedId === id) ui.focusedId = null;
    }
    const kept = ui.selected.filter((id) => !before.has(id) || after.has(id));
    if (kept.length < ui.selected.length) {
      ui.selected = kept;
      toast('A widget you were editing was deleted on another device');
    }
    this.changed(deskId, { origin: 'remote', network });
  }

  /** Deletes a preset file; closes its desk first if it is open. */
  async remove(id: string) {
    if (this.isOpen(id)) {
      if (this.desks.length <= 1) await this.newDesk('My desk');
      await this.closeDesk(id);
    }
    await presetIpc.remove(id);
    await lookStore.forgetDesk(id);
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
    for (const w of old.widgets) forgetWidget(w.id);
    const replaced: Preset = {
      ...incoming,
      id: old.id,
      color: old.color, // the desk keeps its identity
      createdAt: old.createdAt,
      updatedAt: new Date().toISOString(),
    };
    this.desks[i] = replaced;
    for (const w of replaced.widgets) values[w.id] = initialValue(w);
    if (this.activeId === deskId) {
      ui.selected = [];
      ui.focusedId = null;
    }
    await networkStore.apply(deskId, this.snapshot(deskId).network);
    this.changed(deskId, { deleted: removedKeys(old, replaced) });
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

  /** Number of widget messages (and sequences, see `WidgetDef.outputRefs`) that send to an output. */
  outputUsage(outputId: string): number {
    return this.current.widgets.reduce(
      (n, w) =>
        n +
        w.bindings.filter((b) => b.outputIds.includes(outputId)).length +
        (outputRefsOf(w).includes(outputId) ? 1 : 0),
      0,
    );
  }

  /** Number of widget messages that listen on an endpoint (an input, or an output's replies). */
  sourceUsage(endpointId: string): number {
    return this.current.widgets.reduce(
      (n, w) => n + w.bindings.filter((b) => b.sourceIds.includes(endpointId)).length,
      0,
    );
  }

  /** Removes an output and every reference to it from widgets. */
  removeOutput(id: string) {
    for (const w of this.current.widgets) {
      for (const b of w.bindings) {
        b.outputIds = b.outputIds.filter((o) => o !== id);
        b.sourceIds = b.sourceIds.filter((s) => s !== id);
      }
      dropOutputFrom(w, id);
    }
    this.current.network.outputs = this.current.network.outputs.filter((o) => o.id !== id);
    this.touch({ network: true, deleted: [syncKey.output(id)] });
  }

  /** Removes an input and every reference to it from widget messages. */
  removeInput(id: string) {
    for (const w of this.current.widgets)
      for (const b of w.bindings) b.sourceIds = b.sourceIds.filter((s) => s !== id);
    this.current.network.inputs = this.current.network.inputs.filter((i) => i.id !== id);
    this.touch({ network: true, deleted: [syncKey.input(id)] });
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

  /**
   * Adds a widget of `type`, selected: where it was dropped (`rect` in the grid of `at`, a frame's
   * tab or the desk; refused there if it may not go or the cells are taken), else where ADD puts
   * it (`addingTo`), at its usual size or the largest smaller one that fits.
   */
  addWidget(type: WidgetType, dropped?: { rect: Rect; at: TabRef | null }) {
    const desk = this.current;
    const at = dropped ? dropped.at : type === 'tabs' ? null : this.addingTo;
    const grid = gridOn(desk, at);
    const on = widgetsOn(desk, at);
    let spot: Rect | null;
    if (dropped) {
      const { x, y, w, h } = dropped.rect;
      spot = { x, y, w, h };
      if (!canHold(desk, at, type) || !isFree(spot, grid, on)) return;
    } else spot = findRoom(DEFS[type].defaultSize, grid, on);
    if (!spot) {
      toast(NO_ROOM, 'error');
      return;
    }
    const firstOutput = desk.network.outputs[0]?.id;
    const n = desk.widgets.filter((w) => w.type === type).length + 1;
    const w = newWidget(type, spot, firstOutput ? [firstOutput] : [], n, at);
    desk.widgets.push(w);
    values[w.id] = initialValue(w);
    ui.selected = [w.id];
    this.touch();
  }

  /**
   * A copy next to the original, on the same tab (or the desk). A frame is copied with everything
   * on its tabs; references to widgets outside it stay as they were.
   */
  duplicateWidget(id: string) {
    const src = this.widget(id);
    if (!src) return;
    const at = this.tabOf(id);
    const spot = findFreeSpot(
      { w: src.w, h: src.h },
      gridOn(this.current, at),
      widgetsOn(this.current, at),
    );
    if (!spot) {
      toast('No free space for a copy of this size', 'error');
      return;
    }
    const inside = new Set(childrenOf(this.current, id).map((w) => w.id));
    const subtree = this.current.widgets.filter((w) => w.id === id || inside.has(w.id));
    const outside = this.current.widgets.filter((w) => w.id !== id && !inside.has(w.id));
    const { widgets, ids } = freshCopies(
      $state.snapshot(subtree) as Widget[],
      outside.map((w) => w.id),
    );
    const copy = widgets.find((w) => w.id === ids.get(id))!;
    Object.assign(copy, spot, { parent: at });
    this.current.widgets.push(...widgets);
    for (const w of widgets) values[w.id] = initialValue(w);
    ui.selected = [copy.id];
    this.touch();
  }

  /** Removes widgets; a frame goes with everything on its tabs. */
  removeWidgets(ids: readonly string[]) {
    const gone = new Set(ids);
    for (const id of ids) for (const w of childrenOf(this.current, id)) gone.add(w.id);
    this.dropWidgets([...gone]);
    this.touch({ deleted: [...gone].map(syncKey.widget) });
  }

  /** Takes widgets off the active desk and forgets what they left behind. */
  private dropWidgets(ids: readonly string[]) {
    if (ids.length === 0) return;
    const gone = new Set(ids);
    this.current.widgets = this.current.widgets.filter((w) => !gone.has(w.id));
    for (const id of ids) forgetWidget(id);
    ui.selected = ui.selected.filter((id) => !gone.has(id));
    if (ui.focusedId && gone.has(ui.focusedId)) ui.focusedId = null;
  }

  /**
   * Puts widgets at `rects` in the grid of `parent` (a frame's tab; null: the desk), all of them
   * or none: a drop, a nudge or a resize, of one widget or a selection. Refused where one may not
   * go (a frame on a tab), or where they would sit off the grid, on another widget or on each
   * other. Each one's rect and parent change together, one change for sync (`w/<id>/rect`).
   */
  moveWidgets(rects: readonly Placed[], parent: TabRef | null): boolean {
    const desk = this.current;
    const widgets = rects.map((r) => this.widget(r.id));
    if (widgets.length === 0 || widgets.some((w) => !w || !canPlace(desk, w.id, parent)))
      return false;
    if (!allFree(rects, gridOn(desk, parent), widgetsOn(desk, parent))) return false;
    const placed = placements(desk);
    let changed = false;
    rects.forEach(({ x, y, w: width, h }, i) => {
      const w = widgets[i]!;
      const same = w.x === x && w.y === y && w.w === width && w.h === h;
      if (same && sameTab(placed.get(w.id) ?? null, parent)) return;
      Object.assign(w, { x, y, w: width, h, parent: parent && { ...parent } });
      changed = true;
    });
    if (changed) this.touch();
    return true;
  }

  /**
   * Resizes the grid of the desk, or of a frame (one for all its tabs). Refuses to shrink it
   * under existing widgets instead of silently moving them.
   */
  setGrid(patch: Partial<Grid>, frameId?: string): boolean {
    const desk = this.current;
    const frame = frameId === undefined ? null : this.widget(frameId);
    if (frame !== null && !isTabs(frame)) return false;
    const next = { ...(frame ? frame.props.grid : desk.grid), ...patch };
    const on = frame ? childrenOf(desk, frame.id) : widgetsOn(desk, null);
    const clipped = outOfBounds(on, next);
    if (clipped.length) {
      toast(
        `${clipped.length} widget(s) would fall outside a ${next.cols}×${next.rows} grid; move them first`,
        'error',
      );
      return false;
    }
    if (frame) frame.props.grid = next;
    else desk.grid = next;
    this.touch();
    return true;
  }

  // ---- frames (model/tabs.ts) -----------------------------------------------------------

  /** Where a widget of the active desk shows: a frame's tab, or the desk (null). */
  tabOf(id: string): TabRef | null {
    return placements(this.current).get(id) ?? null;
  }

  /** The selected widgets of the active desk, in the order they were picked. */
  get selection(): Widget[] {
    return ui.selected.flatMap((id) => this.widget(id) ?? []);
  }

  /**
   * Selects a widget alone (null: nothing), or with `add` (Shift) adds it to the selection or
   * takes it out. A selection stays on one grid, the desk's or one frame tab's: a widget from
   * another starts a new one.
   */
  select(id: string | null, add = false) {
    if (!id) ui.selected = [];
    else if (!add) ui.selected = [id];
    else if (ui.selected.includes(id)) ui.selected = ui.selected.filter((s) => s !== id);
    else {
      const placed = placements(this.current);
      const here = placed.get(id) ?? null;
      const same = ui.selected.filter((s) => sameTab(placed.get(s) ?? null, here));
      ui.selected = [...same, id];
    }
  }

  /**
   * Where ADD puts a new widget: on the tab the selected frame shows, or beside the selected
   * widgets on their tab, else on the desk. A frame always goes on the desk.
   */
  get addingTo(): TabRef | null {
    const [first, ...more] = this.selection;
    if (!first) return null;
    if (isTabs(first) && more.length === 0)
      return { widget: first.id, tab: shownTab(first, values[first.id]).id };
    return this.tabOf(first.id);
  }

  /** Shows a tab of a frame on this device (never sent or shared). */
  showTab(widgetId: string, tabId: string) {
    values[widgetId] = tabId;
  }

  /** Adds an empty tab to a frame, and shows it; refused past the tab limit. */
  addTab(widgetId: string): boolean {
    const w = this.widget(widgetId);
    if (!isTabs(w)) return false;
    if (tabsFull(w)) {
      toast(TOO_MANY_TABS, 'error');
      return false;
    }
    const tab = newTab(`Tab ${w.props.tabs.length + 1}`);
    w.props.tabs.push(tab);
    this.showTab(widgetId, tab.id);
    this.touch();
    return true;
  }

  /** Moves a tab one place earlier (-1) or later (+1). */
  moveTab(widgetId: string, tabId: string, by: -1 | 1) {
    const w = this.widget(widgetId);
    if (!isTabs(w)) return;
    const tabs = w.props.tabs;
    const i = tabs.findIndex((t) => t.id === tabId);
    const j = i + by;
    if (i < 0 || j < 0 || j >= tabs.length) return;
    [tabs[i], tabs[j]] = [tabs[j]!, tabs[i]!];
    this.touch();
  }

  /** Removes a tab and everything on it; a frame keeps at least one. */
  removeTab(widgetId: string, tabId: string) {
    const w = this.widget(widgetId);
    if (!isTabs(w) || w.props.tabs.length <= 1) return;
    const gone = widgetsOn(this.current, { widget: widgetId, tab: tabId }).map((x) => x.id);
    this.dropWidgets(gone);
    w.props.tabs = w.props.tabs.filter((t) => t.id !== tabId);
    if (values[widgetId] === tabId) this.showTab(widgetId, w.props.tabs[0]!.id);
    this.touch({ deleted: gone.map(syncKey.widget) });
  }
}

/** Drops what a removed widget left behind: its live value, feedback and activity. */
function forgetWidget(id: string) {
  delete values[id];
  forgetFeedback(id);
  debugStore.forget(id);
  inputStore.forget(id);
}

/** Sync keys of the widgets and endpoints `before` had and `after` doesn't (replaced desk). */
function removedKeys(before: Preset, after: Preset): string[] {
  const gone = <T extends { id: string }>(a: T[], b: T[]) => {
    const kept = new Set(b.map((x) => x.id));
    return a.filter((x) => !kept.has(x.id)).map((x) => x.id);
  };
  return [
    ...gone(before.widgets, after.widgets).map(syncKey.widget),
    ...gone(before.network.outputs, after.network.outputs).map(syncKey.output),
    ...gone(before.network.inputs, after.network.inputs).map(syncKey.input),
  ];
}

export const presetStore = new PresetStore();
