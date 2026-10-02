// The workspace: every open desk is a preset (layout, widgets, network config), shown
// as a tab. All open desks' networks run at the same time; editing always happens on the
// active desk (`current`). Every change of any desk ends in `changed()`, which autosaves it
// (see autosave.svelte.ts), re-applies its network config when endpoints changed, and tells
// sync (state/changes.ts). `touch()` is `changed()` for the active desk.
import { presets as presetIpc, sync as syncIpc } from '../ipc/commands';
import type { PresetSummary } from '../ipc/types';
import { findFreeSpot, findRoom, outOfBounds, type Rect } from '../grid/engine';
import { EmbedError, planEmbed, routeTo, type EmbedPlan, type EmbedTarget } from '../model/embed';
import { freshCopies, newInput, newOutput, newPreset, withFreshWidgetIds } from '../model/factory';
import { migratePreset } from '../model/migrations';
import { uid } from '../model/parts';
import {
  PresetSchema,
  type Grid,
  type Preset,
  type Widget,
  type WidgetType,
} from '../model/preset';
import {
  canHoldSubdesk,
  canPlace,
  depthOf,
  descendantsOf,
  gridOn,
  isSubdesk,
  pageAt,
  placements,
  resolvePage,
  widgetsOn,
  widgetsUnder,
  type PageRef,
} from '../model/subdesks';
import { getSetting } from '../platform/settings';
import { patchInPlace } from '../sync/reconcile';
import { PALETTE_SIZE } from '../theme/palettes';
import { errorText } from '../util';
import { DEFS, dropOutputFrom, initialValue, newWidget, outputRefsOf } from '../widgets/defs';
import {
  blankPage,
  copiedPage,
  pagesFull,
  shownPage,
  TOO_DEEP,
  TOO_MANY_PAGES,
} from '../widgets/subdesk/def';
import { appearance } from './appearance.svelte';
import { Autosave } from './autosave.svelte';
import { deskChanges, syncKey, syncRecords } from './changes';
import { debugStore } from './debug.svelte';
import { forgetFeedback } from './feedback.svelte';
import { inputStore } from './input.svelte';
import { lookStore } from './look.svelte';
import { networkStore } from './network.svelte';
import { persistSetting } from './persist';
import { toast, ui } from './ui.svelte';
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
    ui.selectedId = ui.focusedId = ui.page = null;
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
      ui.selectedId = ui.focusedId = ui.page = null;
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
      if (ui.selectedId === id) {
        ui.selectedId = null;
        toast('The widget you were editing was deleted on another device');
      }
    }
    if (deskId === this.activeId && ui.page && !resolvePage(desk, ui.page)) {
      ui.page = null;
      toast('The sub-desk page you were editing was deleted on another device');
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
    if (this.activeId === deskId) ui.selectedId = ui.focusedId = ui.page = null;
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

  // ---- sub-desk pages (model/subdesks.ts) --------------------------------------------------

  /**
   * The sub-desk page open on the canvas (EDIT only; `ui.page`), while it still exists; null
   * is the desk itself. What the desk's editing does (add, grid, nudge) happens there.
   */
  get page(): PageRef | null {
    return ui.mode === 'edit' ? resolvePage(this.current, ui.page) : null;
  }

  /** Where a widget of the active desk shows: a sub-desk page, or the desk (null). */
  pageOf(id: string): PageRef | null {
    return placements(this.current).get(id)?.page ?? null;
  }

  /** Opens a sub-desk page on the canvas (null: back to the desk). */
  openPage(ref: PageRef | null) {
    ui.page = resolvePage(this.current, ref);
    ui.selectedId = null;
  }

  /** Goes up from the open page to where its sub-desk is, the sub-desk selected. */
  closePage() {
    const page = this.page;
    if (!page) return;
    ui.page = this.pageOf(page.widget);
    ui.selectedId = page.widget;
  }

  /** Opens the page a sub-desk is showing. */
  openSubdesk(id: string) {
    const w = this.widget(id);
    if (isSubdesk(w)) this.openPage({ widget: id, page: shownPage(w, values[id]).id });
  }

  /** Selects a widget wherever it is: the page it is on opens with it. */
  reveal(id: string) {
    ui.page = this.pageOf(id);
    ui.selectedId = id;
  }

  /** Shows a page of a sub-desk on this device (never sent or shared). */
  showPage(widgetId: string, pageId: string) {
    values[widgetId] = pageId;
  }

  /** Adds a blank page to a sub-desk; refused past the page limit. */
  addBlankPage(widgetId: string): boolean {
    const w = this.widget(widgetId);
    if (!isSubdesk(w)) return false;
    if (pagesFull(w)) {
      toast(TOO_MANY_PAGES, 'error');
      return false;
    }
    const page = blankPage(`Page ${w.props.pages.length + 1}`);
    w.props.pages.push(page);
    this.showPage(widgetId, page.id);
    this.touch();
    return true;
  }

  /** Moves a page one place earlier (-1) or later (+1) among the tabs. */
  movePage(widgetId: string, pageId: string, by: -1 | 1) {
    const w = this.widget(widgetId);
    if (!isSubdesk(w)) return;
    const pages = w.props.pages;
    const i = pages.findIndex((p) => p.id === pageId);
    const j = i + by;
    if (i < 0 || j < 0 || j >= pages.length) return;
    [pages[i], pages[j]] = [pages[j]!, pages[i]!];
    this.touch();
  }

  /**
   * Copies a saved desk onto a sub-desk page of the active desk (model/embed.ts). `ask` sees
   * what it would do first and may say no; the copy is then planned again, since the desk may
   * have changed meanwhile. Throws an EmbedError when it can't go there.
   */
  async embed(
    sourceId: string,
    target: EmbedTarget,
    ask: (plan: EmbedPlan, source: Preset) => Promise<boolean> = async () => true,
  ): Promise<boolean> {
    // An open desk as it is now, else as last saved.
    const source = this.isOpen(sourceId)
      ? this.snapshot(sourceId)
      : await this.loadPreset(sourceId);
    if (!(await ask(this.prepareEmbed(source, target).plan, source))) return false;
    this.prepareEmbed(source, target).apply();
    return true;
  }

  /** What copying `source` to `target` would add, and how to make it so. */
  private prepareEmbed(source: Preset, target: EmbedTarget): { plan: EmbedPlan; apply(): void } {
    const desk = this.current;
    const page = copiedPage(source);

    if (target.kind === 'new') {
      const on = this.page;
      if (!canHoldSubdesk(desk, on)) throw new EmbedError(TOO_DEEP);
      const spot = this.roomHere(DEFS.subdesk.defaultSize);
      if (!spot) throw new EmbedError(NO_ROOM);
      const n = desk.widgets.filter((w) => w.type === 'subdesk').length + 1;
      const sub = newWidget('subdesk', spot, [], n, on);
      sub.label = source.name;
      sub.props.pages = [page];
      const plan = planEmbed(
        desk,
        source,
        { widget: sub.id, page: page.id },
        depthOf(desk, on) + 1,
      );
      return {
        plan,
        apply: () => {
          desk.widgets.push(sub);
          this.showPage(sub.id, page.id);
          this.addCopies(plan);
          ui.selectedId = sub.id;
          this.touch();
        },
      };
    }

    const sub = this.widget(target.widget);
    if (!isSubdesk(sub)) throw new EmbedError('That sub-desk is gone');
    if (target.kind === 'page') {
      if (pagesFull(sub)) throw new EmbedError(TOO_MANY_PAGES);
      const slot = { widget: sub.id, page: page.id };
      const plan = planEmbed(desk, source, slot, depthOf(desk, slot));
      return {
        plan,
        apply: () => {
          sub.props.pages.push(page);
          this.addCopies(plan);
          this.showPage(sub.id, page.id);
          this.touch();
        },
      };
    }

    const old = sub.props.pages.find((p) => p.id === target.page);
    if (!old) throw new EmbedError('That page is gone');
    const slot = { widget: sub.id, page: old.id };
    const plan = planEmbed(desk, source, slot, depthOf(desk, slot));
    return {
      plan,
      apply: () => {
        const gone = widgetsUnder(desk, slot).map((w) => w.id);
        this.dropWidgets(gone);
        Object.assign(old, { source: page.source, copiedAt: page.copiedAt, grid: page.grid });
        this.addCopies(plan);
        this.touch({ deleted: gone.map(syncKey.widget) });
      },
    };
  }

  /** Adds a desk's copied widgets (`planEmbed`) to the active desk. */
  private addCopies(plan: EmbedPlan) {
    this.current.widgets.push(...plan.widgets);
    for (const w of plan.widgets) values[w.id] = initialValue(w);
  }

  /** Sends everything on a page (its sub-desks' pages too) to one output of the desk. */
  routePage(widgetId: string, pageId: string, outputId: string) {
    if (!this.current.network.outputs.some((o) => o.id === outputId)) return;
    routeTo(widgetsUnder(this.current, { widget: widgetId, page: pageId }), outputId);
    this.touch();
  }

  /** Removes a page and everything on it; a sub-desk keeps at least one. */
  removePage(widgetId: string, pageId: string) {
    const w = this.widget(widgetId);
    if (!isSubdesk(w) || w.props.pages.length <= 1) return;
    const gone = widgetsUnder(this.current, { widget: widgetId, page: pageId }).map((x) => x.id);
    this.dropWidgets(gone);
    w.props.pages = w.props.pages.filter((p) => p.id !== pageId);
    if (values[widgetId] === pageId) this.showPage(widgetId, w.props.pages[0]!.id);
    this.touch({ deleted: gone.map(syncKey.widget) });
  }

  // ---- widgets --------------------------------------------------------------------------

  /** Room for a new widget on the open page (or the desk): its usual size, or the largest
   *  smaller one that fits there. */
  private roomHere(size: { w: number; h: number }): Rect | null {
    return findRoom(size, gridOn(this.current, this.page), widgetsOn(this.current, this.page));
  }

  addWidget(type: WidgetType) {
    const page = this.page;
    if (type === 'subdesk' && !canHoldSubdesk(this.current, page)) {
      toast(TOO_DEEP, 'error');
      return;
    }
    const spot = this.roomHere(DEFS[type].defaultSize);
    if (!spot) {
      toast(NO_ROOM, 'error');
      return;
    }
    const firstOutput = this.current.network.outputs[0]?.id;
    const n = this.current.widgets.filter((w) => w.type === type).length + 1;
    const w = newWidget(type, spot, firstOutput ? [firstOutput] : [], n, page);
    this.current.widgets.push(w);
    values[w.id] = initialValue(w);
    ui.selectedId = w.id;
    this.touch();
  }

  /**
   * A copy next to the original, on the same page. A sub-desk is copied with everything on its
   * pages; references to widgets outside it stay as they were.
   */
  duplicateWidget(id: string) {
    const src = this.widget(id);
    if (!src) return;
    const page = this.pageOf(id);
    const spot = findFreeSpot(
      { w: src.w, h: src.h },
      gridOn(this.current, page),
      widgetsOn(this.current, page),
    );
    if (!spot) {
      toast('No free space for a copy of this size', 'error');
      return;
    }
    const inside = new Set(descendantsOf(this.current, id).map((w) => w.id));
    const subtree = this.current.widgets.filter((w) => w.id === id || inside.has(w.id));
    const outside = this.current.widgets.filter((w) => w.id !== id && !inside.has(w.id));
    const { widgets, ids } = freshCopies(
      $state.snapshot(subtree) as Widget[],
      outside.map((w) => w.id),
    );
    const copy = widgets.find((w) => w.id === ids.get(id))!;
    Object.assign(copy, spot, { parent: page });
    this.current.widgets.push(...widgets);
    for (const w of widgets) values[w.id] = initialValue(w);
    ui.selectedId = copy.id;
    this.touch();
  }

  /** Removes a widget; a sub-desk goes with everything on its pages. */
  removeWidget(id: string) {
    const gone = [id, ...descendantsOf(this.current, id).map((w) => w.id)];
    if (ui.page && gone.includes(ui.page.widget)) ui.page = this.pageOf(id);
    this.dropWidgets(gone);
    this.touch({ deleted: gone.map(syncKey.widget) });
  }

  /** Takes widgets off the active desk and forgets what they left behind. */
  private dropWidgets(ids: readonly string[]) {
    if (ids.length === 0) return;
    const gone = new Set(ids);
    this.current.widgets = this.current.widgets.filter((w) => !gone.has(w.id));
    for (const id of ids) forgetWidget(id);
    if (ui.selectedId && gone.has(ui.selectedId)) ui.selectedId = null;
    if (ui.focusedId && gone.has(ui.focusedId)) ui.focusedId = null;
  }

  setRect(id: string, rect: Rect) {
    const w = this.widget(id);
    if (!w) return;
    Object.assign(w, rect);
    this.touch();
  }

  /**
   * Puts a widget on another page (or the desk), at the first spot where it fits (smaller if a
   * smaller page has no room for its size), and opens that
   * page. Never into itself, a sub-desk inside it, or past the depth limit (`canPlace`).
   */
  place(id: string, ref: PageRef | null): boolean {
    const w = this.widget(id);
    if (!w) return false;
    if (!canPlace(this.current, id, ref)) {
      toast('It can’t go there: not into itself, nor deeper than sub-desks nest', 'error');
      return false;
    }
    const spot = findRoom(
      { w: w.w, h: w.h },
      gridOn(this.current, ref),
      widgetsOn(this.current, ref).filter((x) => x.id !== id),
    );
    if (!spot) {
      toast('No free space there: make room first', 'error');
      return false;
    }
    Object.assign(w, spot, { parent: ref });
    ui.page = ref;
    ui.selectedId = id;
    this.touch();
    return true;
  }

  /**
   * Resizes the grid of the open page (or the desk). Refuses to shrink it under existing
   * widgets instead of silently moving them.
   */
  setGrid(patch: Partial<Grid>): boolean {
    const page = this.page;
    const found = page ? pageAt(this.current, page) : undefined;
    const next = { ...(found?.page.grid ?? this.current.grid), ...patch };
    const clipped = outOfBounds(widgetsOn(this.current, page), next);
    if (clipped.length) {
      toast(
        `${clipped.length} widget(s) would fall outside a ${next.cols}×${next.rows} grid; move them first`,
        'error',
      );
      return false;
    }
    if (found) found.page.grid = next;
    else this.current.grid = next;
    this.touch();
    return true;
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
