// Shared desks: desks kept in step with the other devices of the session. Everyone may edit
// at any time. Changes merge per field (paths.ts, deskdoc.ts), and the later change to the
// same field wins. How it holds together:
//   - local edits become ops. Every edit path ends in `presetStore.changed()`, which reaches
//     `localChange` here. A short debounce later, the desk is compared with what was last in
//     step (`base`); changed fields get fresh stamps, go into the record, and are sent;
//   - nothing is deleted by inference. Only explicit deletions (removeWidgets, removeOutput,
//     removeInput, importInto) make tombstones. Anything else that went missing comes back
//     from the record;
//   - remote ops are validated, merged, and applied to the open desk in place
//     (reconcile.ts). They are never sent on (no relaying), and applying them never counts as
//     a local edit;
//   - every 5 s each device sends a digest of each shared desk. A mismatch makes both sides
//     send their full state, which repairs lost messages and a partial mesh
//     (A↔B↔C without A↔C);
//   - while FROZEN, remote edits are merged into the record but applied only after unfreezing.
//     A remote batch that deletes many widgets waits for confirmation.
// Records survive restarts (saved with the preset) and are kept even while a desk isn't
// shared, so sharing it again merges like a reconnect. This class takes its collaborators
// as parameters, so tests can run several against each other; app.svelte.ts wires the real
// ones.
import { canonical } from '../canonical';
import type { Preset, Widget } from '../model/preset';
import type { WidgetValue } from '../osc/value';
import type { DeskChange, LocalValueChange } from '../state/changes';
import type { PeerChange, SyncBus } from './bus';
import { findConflicts } from './conflicts';
import { baseOf, DeskDoc, fromWire, localChanges, type Entry } from './deskdoc';
import { Hlc, newer } from './hlc';
import { flatten, materialize, ownerKey, parseKey, validEntry, type ParsedKey } from './paths';
import {
  DocIdSchema,
  EntrySchema,
  MAX_OPS,
  type DeskAnnounce,
  type DeskDigest,
  type DeskOps,
  type DeskRequest,
  type DeskState,
  type Presence,
  type Values,
  type WireEntry,
} from './protocol';
import { IdSchema, type WidgetType } from '../model/preset';
import { LiveValues } from './values';
import { z } from 'zod';

/** Local edits are collected this long before becoming ops. */
export const DIFF_MS = 50;
export const DIGEST_MS = 5000;
export const JOIN_TIMEOUT_MS = 10_000;
/** A remote batch deleting more widgets than this (or more than MASS_DELETE_SHARE) asks first. */
export const MASS_DELETE_MAX = 10;
export const MASS_DELETE_SHARE = 0.5;
/** Digest mismatches in a row before a peer is reported as not settling. */
const MISMATCH_WARN = 4;
/** Ops per DeskOps message, and roughly how many bytes. */
const OPS_CHUNK_BYTES = 512 * 1024;
const STATE_MAX_BYTES = 4 * 1024 * 1024 - 1024;

/** A desk record as saved next to its preset (see src-tauri/src/sync/docs.rs). */
export const RecordFileSchema = z.object({
  version: z.literal(1),
  deskId: IdSchema,
  doc: DocIdSchema,
  shared: z.boolean(),
  entries: z.array(EntrySchema),
});
export type RecordFile = z.infer<typeof RecordFileSchema>;

/** What shared desks need from the workspace. */
export interface Workspace {
  desks(): readonly Preset[];
  /** An open desk (the live object). */
  find(deskId: string): Preset | undefined;
  /** A plain copy of an open desk. */
  snapshot(deskId: string): Preset;
  /** Whether a preset with this id is saved on this device (open or not). */
  hasSaved(deskId: string): boolean;
  open(deskId: string): Promise<void>;
  /** Opens a desk that came from peers, ids unchanged. */
  adopt(desk: Preset): Promise<void>;
  applyRemote(deskId: string, next: Preset, network: boolean): void;
  duplicate(deskId: string, name: string): Promise<void>;
  save(deskId: string): Promise<void>;
  /** A new preset with this id and name: what a joined desk starts from. */
  blank(deskId: string, name: string): Preset;
}

export interface ConfirmOptions {
  title: string;
  message: string;
  details?: string[];
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
}

/** Everything else shared desks need, from the session and the app. */
export interface SharedEnv {
  bus: SyncBus;
  peerId(): string | null;
  joined(): boolean;
  peerName(peer: string): string;
  locked(): boolean;
  paused(): boolean;
  confirm(opts: ConfirmOptions): Promise<boolean>;
  /** Logged to TRAFFIC. */
  note(text: string): void;
  warn(text: string): void;
  loadRecord(deskId: string): Promise<unknown>;
  isTouched(key: string): boolean;
  show(widget: Widget, value: WidgetValue, origin: 'peer' | 'init'): void;
  /** Wall clock in ms (tests replace it). */
  now(): number;
  newDocId(): string;
}

interface Rec {
  doc: DeskDoc;
  shared: boolean;
  /** Key → canonical value, as the open desk had it when last in step with the record. */
  base: Map<string, string>;
  /** Deletions made on purpose since the last diff (creation keys). */
  deleted: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
  /** Remote changes merged but not applied yet (FROZEN). */
  waiting: boolean;
  invalid: string[];
  /** Remote batches, one at a time (a mass-delete question holds the ones behind it). */
  chain: Promise<void>;
  /** Digest mismatches in a row, per peer. */
  streaks: Map<string, number>;
}

export interface DeskView {
  shared: boolean;
  /** Remote changes waiting for unfreeze. */
  waiting: boolean;
  /** Parts of the record that could not be built (hidden). */
  invalid: string[];
}

const isWidgetCreation = (
  p: ParsedKey | null,
): p is { group: 'widget'; id: string; part: 'create' } =>
  p?.group === 'widget' && p.part === 'create';

export class SharedDesks {
  /** Per open desk that has a record. */
  view: Record<string, DeskView> = $state({});
  /** Desks peers share: peer → their desks. */
  available: Record<string, DeskAnnounce['desks']> = $state({});
  /** Desks being fetched from a peer. */
  joining: Record<string, { peer: string; doc: string; name: string }> = $state({});
  /** Peers whose clock is far ahead: peer → ms. */
  clockSkew: Record<string, number> = $state({});
  /** Shared desks whose received OSC input this device forwards. */
  forwarding: string[] = $state([]);
  /** Peers a desk keeps disagreeing with (despite exchanging state). */
  unsettled: Record<string, number> = $state({});

  readonly values: LiveValues;
  private recs = new Map<string, Rec>();
  private hlc: Hlc | null = null;

  constructor(
    private ws: Workspace,
    private env: SharedEnv,
  ) {
    this.values = new LiveValues({
      clock: () => this.hlc,
      desk: (deskId) => {
        const rec = this.recs.get(deskId);
        const desk = this.ws.find(deskId);
        return rec && desk && this.isLive(deskId)
          ? { doc: rec.doc.doc, widgets: desk.widgets }
          : undefined;
      },
      broadcast: (deskId, body) => void this.env.bus.send(null, 'values', deskId, body),
      isTouched: (key) => this.env.isTouched(key),
      show: (w, v, origin) => this.env.show(w, v, origin),
      paused: () => this.env.paused(),
      clockSkew: (peer, ms) => this.noteSkew(peer, ms),
    });
  }

  /** Subscribes to the bus. The clock needs this device's id, so call once it is known. */
  start() {
    const peerId = this.env.peerId();
    if (!peerId || this.hlc) return;
    this.hlc = new Hlc(peerId, () => this.env.now());
    const bus = this.env.bus;
    bus.onPeers((c) => this.onPeer(c));
    bus.on('deskAnnounce', (peer, _desk, body) => (this.available[peer] = body.desks));
    bus.on('deskRequest', (peer, desk, body) => desk && this.onRequest(peer, desk, body));
    bus.on('deskState', (peer, desk, body) => desk && this.onState(peer, desk, body));
    bus.on('deskOps', (peer, desk, body) => desk && this.onOps(peer, desk, body));
    bus.on('deskDigest', (peer, desk, body) => desk && this.onDigest(peer, desk, body));
    bus.on('values', (peer, desk, body: Values) => desk && this.values.receive(peer, desk, body));
  }

  // ---- queries --------------------------------------------------------------------------------

  isShared(deskId: string): boolean {
    return this.recs.get(deskId)?.shared === true;
  }

  /** Shared, open, and the session joined: its changes and values flow. */
  isLive(deskId: string): boolean {
    return this.isShared(deskId) && !!this.ws.find(deskId) && this.env.joined();
  }

  private liveIds(): string[] {
    return [...this.recs.keys()].filter((id) => this.isLive(id));
  }

  /** On a live shared desk, only its forwarder forwards received input. */
  mayForward(deskId: string): boolean {
    return !this.isLive(deskId) || this.forwarding.includes(deskId);
  }

  /** The record to save with a desk (null if it has none). Pending edits are taken in first. */
  recordFile(deskId: string): RecordFile | null {
    const rec = this.recs.get(deskId);
    if (!rec) return null;
    this.diff(deskId);
    return { version: 1, deskId, doc: rec.doc.doc, shared: rec.shared, entries: rec.doc.wire() };
  }

  presence(activeId: string | null, editing: Presence['editing']): Presence {
    const live = (id: string | null | undefined): id is string => !!id && this.isLive(id);
    return {
      viewing: live(activeId) ? activeId : null,
      editing: editing && live(editing.desk) ? editing : null,
      forwarding: this.forwarding.filter(live).slice(0, 64),
      neighbours: [...this.env.bus.peers.keys()].slice(0, 64),
      locked: this.env.locked(),
    };
  }

  // ---- desks opening and closing ------------------------------------------------------------

  /** A desk was opened here: load its record, if it has one (the record wins). */
  async deskOpened(deskId: string) {
    if (this.recs.has(deskId) || !this.hlc) return;
    let raw: unknown;
    try {
      raw = await this.env.loadRecord(deskId);
    } catch (e) {
      this.env.warn(`could not read the sync record of desk ${deskId}: ${String(e)}`);
      return;
    }
    if (raw == null || this.recs.has(deskId) || !this.ws.find(deskId)) return;
    const file = RecordFileSchema.safeParse(raw);
    if (!file.success || file.data.deskId !== deskId) {
      this.env.warn(`the sync record of desk ${deskId} is damaged; the desk is not shared`);
      return;
    }
    const doc = new DeskDoc(deskId, file.data.doc);
    doc.mergeWire(file.data.entries);
    const max = doc.maxStamp();
    if (max) this.hlc.seed(max);
    this.recs.set(deskId, this.newRec(doc, file.data.shared));
    this.applyRecord(deskId);
    this.pushDesks();
  }

  /** A desk was closed here (it was saved with its record first). */
  deskClosed(deskId: string) {
    const rec = this.recs.get(deskId);
    if (!rec) return;
    if (rec.timer) clearTimeout(rec.timer);
    this.recs.delete(deskId);
    this.values.forget(deskId);
    delete this.view[deskId];
    this.pushDesks();
  }

  private newRec(doc: DeskDoc, shared: boolean): Rec {
    return {
      doc,
      shared,
      base: new Map(),
      deleted: new Set(),
      timer: null,
      waiting: false,
      invalid: [],
      chain: Promise.resolve(),
      streaks: new Map(),
    };
  }

  private updateView(deskId: string) {
    const rec = this.recs.get(deskId);
    if (!rec) delete this.view[deskId];
    else this.view[deskId] = { shared: rec.shared, waiting: rec.waiting, invalid: rec.invalid };
  }

  // ---- sharing --------------------------------------------------------------------------------

  /** Shares an open desk with the session (again, if it was shared before: that merges). */
  async share(deskId: string) {
    const desk = this.ws.find(deskId);
    if (!desk || !this.hlc) return;
    let rec = this.recs.get(deskId);
    if (!rec) {
      const doc = new DeskDoc(deskId, this.env.newDocId());
      const flat = flatten(desk);
      doc.merge([...flat].map(([k, v]) => [k, { stamp: this.hlc!.now(), value: v }]));
      rec = this.newRec(doc, true);
      rec.base = baseOf(flat);
      this.recs.set(deskId, rec);
      // Whoever shares a desk forwarded its input so far: they stay its forwarder.
      if (!this.forwarding.includes(deskId)) this.forwarding.push(deskId);
    } else {
      this.diff(deskId);
      rec.shared = true;
    }
    this.updateView(deskId);
    await this.ws.save(deskId);
    this.pushDesks();
    this.sendDigests(null, deskId);
  }

  /** Stops sharing a desk. Its record is kept (sharing again merges like a reconnect). */
  async unshare(deskId: string) {
    const rec = this.recs.get(deskId);
    if (!rec) return;
    this.diff(deskId);
    rec.shared = false;
    this.values.forget(deskId);
    this.updateView(deskId);
    await this.ws.save(deskId);
    this.pushDesks();
  }

  setForwarding(deskId: string, on: boolean) {
    const has = this.forwarding.includes(deskId);
    if (on && !has) this.forwarding.push(deskId);
    if (!on && has) this.forwarding.splice(this.forwarding.indexOf(deskId), 1);
  }

  /** Opens a desk a peer shares: fetches it, or merges it with this device's copy. */
  async open(peer: string, entry: { id: string; doc: string; name: string }) {
    const rec = this.recs.get(entry.id);
    const local = this.ws.find(entry.id);
    if (local) {
      if (rec?.doc.doc === entry.doc) {
        if (!rec.shared) await this.share(entry.id);
        return;
      }
      if (!(await this.confirmLineage(entry, local.name))) return;
      await this.ws.duplicate(entry.id, `${local.name} (mine)`);
    } else if (this.ws.hasSaved(entry.id)) {
      const saved = RecordFileSchema.safeParse(
        await this.env.loadRecord(entry.id).catch(() => null),
      );
      await this.ws.open(entry.id);
      await this.deskOpened(entry.id);
      if (saved.success && saved.data.doc === entry.doc) {
        if (!this.isShared(entry.id)) await this.share(entry.id);
        return;
      }
      const opened = this.ws.find(entry.id);
      if (!opened || !(await this.confirmLineage(entry, opened.name))) return;
      await this.ws.duplicate(entry.id, `${opened.name} (mine)`);
    }
    this.joining[entry.id] = { peer, doc: entry.doc, name: entry.name };
    this.pushDesks();
    await this.env.bus.send(peer, 'deskRequest', entry.id, { doc: entry.doc });
    setTimeout(() => {
      if (this.joining[entry.id]?.doc !== entry.doc) return;
      delete this.joining[entry.id];
      this.pushDesks();
      this.env.warn(`${this.env.peerName(peer)} did not send “${entry.name}”; try again`);
    }, JOIN_TIMEOUT_MS);
  }

  private confirmLineage(entry: { name: string }, localName: string): Promise<boolean> {
    return this.env.confirm({
      title: 'Same id, different desk',
      message: `“${entry.name}” in the session has the same id as your desk “${localName}”, but they are different desks.`,
      details: [
        'Your desk is kept as a copy under a new id, then replaced here by the shared one.',
      ],
      confirmLabel: 'Keep mine as a copy',
    });
  }

  private async finishJoin(peer: string, deskId: string, body: DeskState) {
    const name = this.joining[deskId]?.name ?? deskId;
    delete this.joining[deskId];
    const doc = new DeskDoc(deskId, body.doc);
    doc.merge(this.accept(peer, doc, body.entries));
    const rec = this.newRec(doc, true);
    this.recs.set(deskId, rec);
    if (this.ws.find(deskId)) {
      // Replacing this device's desk of the same id (kept as a copy).
      this.applyRecord(deskId);
    } else {
      const { desk, invalid } = materialize(doc, this.ws.blank(deskId, name));
      rec.invalid = invalid.map((i) => `${i.key}: ${i.error}`);
      try {
        await this.ws.adopt(desk);
      } catch (e) {
        this.recs.delete(deskId);
        this.pushDesks();
        this.env.warn(`could not open “${name}”: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      rec.base = baseOf(flatten(this.ws.find(deskId)!));
      this.updateView(deskId);
    }
    this.pushDesks();
    this.values.receive(peer, deskId, { doc: body.doc, regs: body.values }, 'init');
  }

  // ---- local edits ----------------------------------------------------------------------------

  localChange(change: DeskChange) {
    if (change.origin === 'remote') return;
    const rec = this.recs.get(change.deskId);
    if (!rec) return;
    for (const key of change.deleted ?? []) rec.deleted.add(key);
    rec.timer ??= setTimeout(() => this.diff(change.deskId), DIFF_MS);
  }

  localValue(change: LocalValueChange) {
    this.values.local(change);
  }

  /** Turns what changed in an open desk since the last diff into ops (and sends them). */
  private diff(deskId: string) {
    const rec = this.recs.get(deskId);
    const desk = this.ws.find(deskId);
    if (!rec) return;
    if (rec.timer) clearTimeout(rec.timer);
    rec.timer = null;
    if (!desk || !this.hlc || rec.waiting) return;
    const flat = flatten(desk);
    const { changed, missing } = localChanges(flat, rec.base);
    const ops: [string, Entry][] = [];
    for (const [key, value] of changed) {
      ops.push([key, { stamp: this.hlc.now(), value }]);
      rec.base.set(key, canonical(value));
    }
    for (const owner of rec.deleted) {
      if (rec.doc.live(owner) !== undefined)
        ops.push([owner, { stamp: this.hlc.now(), deleted: true }]);
    }
    let restore = 0;
    for (const key of missing) {
      if (rec.deleted.has(ownerKey(key) ?? key)) rec.base.delete(key);
      else restore++;
    }
    rec.deleted.clear();
    if (ops.length) {
      rec.doc.merge(ops);
      if (this.isLive(deskId))
        this.broadcastOps(
          deskId,
          rec,
          ops.map(([k]) => k),
        );
      if (ops.some(([k]) => k === 'name')) this.announce(null);
    }
    if (restore > 0) {
      // Gone without being deleted on purpose (e.g. ids renamed): the record puts it back.
      this.env.note(`${desk.name}: ${restore} field(s) missing without a deletion were restored`);
      this.applyRecord(deskId);
    }
  }

  private broadcastOps(deskId: string, rec: Rec, keys: string[]) {
    let chunk: WireEntry[] = [];
    let bytes = 0;
    const send = () => {
      if (chunk.length)
        void this.env.bus.send(null, 'deskOps', deskId, { doc: rec.doc.doc, ops: chunk });
      chunk = [];
      bytes = 0;
    };
    for (const entry of rec.doc.wire(keys)) {
      const size = JSON.stringify(entry).length;
      if (chunk.length >= MAX_OPS || (bytes + size > OPS_CHUNK_BYTES && chunk.length)) send();
      chunk.push(entry);
      bytes += size;
    }
    send();
  }

  // ---- remote changes -------------------------------------------------------------------------

  /** Valid entries from a peer, with stamps the clock accepts. */
  private accept(peer: string, doc: DeskDoc, wire: readonly WireEntry[]): [string, Entry][] {
    const batchTypes = new Map<string, WidgetType>();
    for (const e of wire) {
      const p = parseKey(e[0]);
      const type = e.length === 3 ? (e[2] as { type?: unknown } | null)?.type : undefined;
      if (isWidgetCreation(p) && typeof type === 'string') batchTypes.set(p.id, type as WidgetType);
    }
    const typeOf = (id: string) =>
      batchTypes.get(id) ?? (doc.live(`w/${id}`) as { type?: WidgetType } | undefined)?.type;
    const out: [string, Entry][] = [];
    let invalid = 0;
    for (const e of wire) {
      const [key, stamp] = e;
      if (!parseKey(key) || (e.length === 3 && !validEntry(key, e[2], typeOf))) {
        invalid++;
        continue;
      }
      if (!this.hlc!.observe(stamp)) {
        this.noteSkew(peer, this.hlc!.aheadBy(stamp));
        continue;
      }
      out.push([key, fromWire(e)]);
    }
    if (invalid)
      this.env.warn(`ignored ${invalid} invalid change(s) from ${this.env.peerName(peer)}`);
    return out;
  }

  private enqueue(deskId: string, job: () => Promise<void>) {
    const rec = this.recs.get(deskId);
    if (!rec) return;
    rec.chain = rec.chain.then(job).catch((e: unknown) => this.env.warn(`sync: ${String(e)}`));
  }

  /** The chain of remote work on a desk (tests wait for it). */
  settled(deskId: string): Promise<void> {
    return this.recs.get(deskId)?.chain ?? Promise.resolve();
  }

  private async mergeRemote(peer: string, deskId: string, wire: readonly WireEntry[]) {
    const rec = this.recs.get(deskId);
    const desk = this.ws.find(deskId);
    if (!rec || !desk || !this.hlc) return;
    this.diff(deskId);
    const entries = this.accept(peer, rec.doc, wire);
    if (!entries.length) return;

    // Widgets this batch would delete.
    const doomed = entries
      .filter(
        ([k, e]) => e.deleted && isWidgetCreation(parseKey(k)) && rec.doc.live(k) !== undefined,
      )
      .filter(([k, e]) => newer(e.stamp, rec.doc.stamp(k)))
      .map(([k]) => k);
    const count = desk.widgets.length;
    let kept: [string, Entry][] = [];
    if (
      doomed.length > MASS_DELETE_MAX ||
      (doomed.length >= 3 && doomed.length > count * MASS_DELETE_SHARE)
    ) {
      const label = (key: string) => desk.widgets.find((w) => `w/${w.id}` === key)?.label || key;
      const names = doomed.map(label);
      const del = await this.env.confirm({
        title: 'Delete widgets?',
        message: `${this.env.peerName(peer)} deleted ${doomed.length} of ${count} widgets on “${desk.name}”.`,
        details: [
          ...names.slice(0, 8),
          ...(names.length > 8 ? [`and ${names.length - 8} more`] : []),
        ],
        confirmLabel: 'Delete them',
        cancelLabel: 'Keep them',
        danger: true,
      });
      if (!del) {
        const owners = new Set(doomed);
        kept = [...rec.doc.entries].filter(([k, e]) => !e.deleted && owners.has(ownerKey(k) ?? k));
      }
    }

    const before = new Map([...rec.doc.entries].filter(([k]) => k.endsWith('/cfg')));
    const changed = rec.doc.merge(entries);
    if (kept.length) {
      // Kept: written again, newer than the deletion, for everyone.
      const again = kept.map(
        ([k, e]) => [k, { stamp: this.hlc!.now(), value: e.value }] as [string, Entry],
      );
      rec.doc.merge(again);
      this.broadcastOps(
        deskId,
        rec,
        again.map(([k]) => k),
      );
      this.env.note(
        `${desk.name}: kept ${doomed.length} widgets ${this.env.peerName(peer)} deleted`,
      );
    }
    if (!changed.length && !kept.length) return;
    this.logNetworkChanges(peer, desk, before, rec.doc, changed);
    this.applyRecord(deskId);
    if (changed.includes('name')) this.announce(null);
  }

  /** Remote changes to where OSC goes are worth a line in TRAFFIC, with before and after. */
  private logNetworkChanges(
    peer: string,
    desk: Preset,
    before: Map<string, Entry>,
    doc: DeskDoc,
    changed: string[],
  ) {
    for (const key of changed) {
      if (!key.endsWith('/cfg')) continue;
      const was = before.get(key)?.value as Record<string, unknown> | undefined;
      const now = doc.live(key) as Record<string, unknown> | undefined;
      if (!now) continue;
      const where = (c: Record<string, unknown> | undefined) =>
        c ? `${c.host !== undefined ? `${String(c.host)}:` : 'port '}${String(c.port)}` : 'new';
      if (!was || was.host !== now.host || was.port !== now.port) {
        this.env.note(
          `${this.env.peerName(peer)} changed ${String(now.name)} on “${desk.name}”: ${where(was)} → ${where(now)}`,
        );
      }
    }
  }

  /** Applies the record to the open desk (the merged state wins), unless FROZEN. */
  private applyRecord(deskId: string) {
    const rec = this.recs.get(deskId);
    const desk = this.ws.find(deskId);
    if (!rec || !desk) return;
    if (this.env.locked()) {
      rec.waiting = true;
      this.updateView(deskId);
      return;
    }
    const local = this.ws.snapshot(deskId);
    const { desk: next, invalid } = materialize(rec.doc, local);
    const network = canonical(next.network) !== canonical(local.network);
    this.ws.applyRemote(deskId, next, network);
    rec.base = baseOf(flatten(this.ws.find(deskId)!));
    rec.waiting = false;
    rec.invalid = invalid.map((i) => `${i.key}: ${i.error}`);
    this.updateView(deskId);
  }

  /** FREEZE was released: apply what waited. */
  unlocked() {
    for (const [deskId, rec] of this.recs) if (rec.waiting) this.applyRecord(deskId);
  }

  private onOps(peer: string, deskId: string, body: DeskOps) {
    if (!this.isLive(deskId) || this.recs.get(deskId)?.doc.doc !== body.doc) return;
    this.enqueue(deskId, () => this.mergeRemote(peer, deskId, body.ops));
  }

  private onState(peer: string, deskId: string, body: DeskState) {
    const joining = this.joining[deskId];
    if (joining && joining.peer === peer && joining.doc === body.doc) {
      void this.finishJoin(peer, deskId, body);
      return;
    }
    if (!this.isLive(deskId) || this.recs.get(deskId)?.doc.doc !== body.doc) return;
    this.enqueue(deskId, async () => {
      await this.mergeRemote(peer, deskId, body.entries);
      this.values.receive(peer, deskId, { doc: body.doc, regs: body.values }, 'init');
    });
  }

  private onRequest(peer: string, deskId: string, body: DeskRequest) {
    if (this.isLive(deskId) && this.recs.get(deskId)?.doc.doc === body.doc)
      this.sendState(peer, deskId);
  }

  private onDigest(peer: string, deskId: string, body: DeskDigest) {
    const rec = this.recs.get(deskId);
    if (!rec || !this.isLive(deskId) || rec.doc.doc !== body.doc) return;
    this.diff(deskId);
    if (rec.doc.digest() === body.digest) {
      rec.streaks.delete(peer);
      delete this.unsettled[peer];
      return;
    }
    const n = (rec.streaks.get(peer) ?? 0) + 1;
    rec.streaks.set(peer, n);
    if (n >= MISMATCH_WARN) {
      this.unsettled[peer] = n;
      if (n === MISMATCH_WARN)
        this.env.warn(
          `“${this.ws.find(deskId)?.name}” keeps differing from ${this.env.peerName(peer)}'s copy; update OscOctopus on both devices`,
        );
      if ((n & (n - 1)) !== 0) return; // back off: only at powers of two
    }
    this.sendState(peer, deskId);
  }

  private sendState(peer: string, deskId: string) {
    const rec = this.recs.get(deskId);
    if (!rec) return;
    this.diff(deskId);
    const body: DeskState = {
      doc: rec.doc.doc,
      entries: rec.doc.wire(),
      values: this.values.snapshot(deskId),
    };
    if (JSON.stringify(body).length > STATE_MAX_BYTES) {
      this.env.warn(`“${this.ws.find(deskId)?.name}” is too large to share in full`);
      return;
    }
    void this.env.bus.send(peer, 'deskState', deskId, body);
  }

  // ---- session --------------------------------------------------------------------------------

  private onPeer(change: PeerChange) {
    if (change.type === 'up') {
      this.announce(change.peer.peerId);
      this.sendDigests(change.peer.peerId);
      return;
    }
    const peer = change.peer;
    delete this.available[peer];
    delete this.clockSkew[peer];
    delete this.unsettled[peer];
    for (const rec of this.recs.values()) rec.streaks.delete(peer);
    for (const [deskId, j] of Object.entries(this.joining)) {
      if (j.peer !== peer) continue;
      delete this.joining[deskId];
      this.env.warn(`${this.env.peerName(peer)} left before sending “${j.name}”`);
    }
  }

  /** Tells the transport which desks to let through, and peers which desks are shared here. */
  pushDesks() {
    for (const id of this.recs.keys()) this.updateView(id);
    void this.env.bus.setDesks([...this.liveIds(), ...Object.keys(this.joining)]);
    this.announce(null);
  }

  private announce(peer: string | null) {
    if (!this.env.joined()) return;
    const desks = this.liveIds()
      .slice(0, 64)
      .map((id) => ({
        id,
        doc: this.recs.get(id)!.doc.doc,
        name: (this.ws.find(id)?.name ?? id).slice(0, 200),
      }));
    void this.env.bus.send(peer, 'deskAnnounce', null, { desks });
  }

  /** Digests of the live shared desks (every DIGEST_MS, and to a peer that just connected). */
  sendDigests(peer: string | null = null, only?: string) {
    if (!this.env.joined()) return;
    for (const deskId of only ? [only] : this.liveIds()) {
      const rec = this.recs.get(deskId);
      if (!rec || !this.isLive(deskId)) continue;
      this.diff(deskId);
      void this.env.bus.send(peer, 'deskDigest', deskId, {
        doc: rec.doc.doc,
        digest: rec.doc.digest(),
        count: rec.doc.entries.size,
      });
    }
  }

  private noteSkew(peer: string, aheadMs: number) {
    const first = this.clockSkew[peer] === undefined;
    this.clockSkew[peer] = aheadMs;
    if (first)
      this.env.warn(
        `${this.env.peerName(peer)}'s clock is ${Math.round(aheadMs / 1000)} s ahead: its changes are ignored until the clocks agree`,
      );
  }

  /** Conflicts on an open shared desk, for the banner. */
  conflicts(deskId: string) {
    const desk = this.ws.find(deskId);
    return desk && this.isShared(deskId) ? findConflicts(desk) : [];
  }
}
