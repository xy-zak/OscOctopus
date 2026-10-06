// One drag at a time across a desk's grids: the desk's own and the shown tab of each frame on it
// (docs/ARCHITECTURE.md › Frames). The desk view makes it (Desk.svelte). What is dragged is one
// widget or the selection, moved by its body or resized from a handle, all alike; or a new widget
// brought in from ADD (AddPanel.svelte). Each canvas registers while editing. Once lifted (past
// the tap slop), the session follows that pointer itself, through window listeners, works out
// where the widgets would land (engine.ts `landing`, `resizeAll`) and commits a valid drop. So a
// widget can be drawn again elsewhere mid-drag (its frame showing another tab) without the drag
// ending.
import { untrack } from 'svelte';
import type { TabRef, WidgetType } from '../model/preset';
import { tabKey } from '../model/tabs';
import {
  allFree,
  bounds,
  landing,
  pxToCells,
  resizeAll,
  toPx,
  type Box,
  type Ground,
  type GridSize,
  type Handle,
  type Landing,
  type Metrics,
  type Placed,
  within,
} from './engine';

/** A grid a carried widget can be put down on, as its canvas registers it. */
export interface DropTarget {
  /** The tab it shows; null: the desk. */
  at: TabRef | null;
  element: Element;
  grid: GridSize;
  metrics: Metrics;
  /** What is on it. */
  widgets: readonly Placed[];
}

/** Widgets of the desk being dragged, all on one grid. */
export interface Carry {
  /** Moved by their body, or resized from a handle. */
  kind: 'move' | Handle;
  ids: readonly string[];
  /** The tab they are on; null: the desk. */
  from: TabRef | null;
  pointerId: number;
  /** Where the pointer was when it went down. */
  x0: number;
  y0: number;
  /** Where they are in their grid (read live). */
  rects: () => readonly Placed[];
}

/** A new widget of `type`, brought in from ADD and held by its middle: added where it is let go. */
export interface Add {
  kind: 'add';
  type: WidgetType;
  /** Its size in cells (its usual one; shrunk to fit a smaller grid). */
  size: { w: number; h: number };
  pointerId: number;
}

export type Lift = Carry | Add;

/** Where a drag of a widget starts: its pointer, where it went down, and whether Shift is held. */
export interface DragStart {
  pointerId: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
  add: boolean;
}

export type Drop = Landing<TabRef>;

/** What the window says about a pointer (a PointerEvent, or a test's stand-in). */
export interface PointerNews {
  type: string;
  pointerId: number;
  pointerType: string;
  buttons: number;
  clientX: number;
  clientY: number;
}

interface Deps {
  /** Whether what is dragged may go on a tab (model/tabs.ts `canHold`, `canPlace`). */
  accepts(l: Lift, at: TabRef): boolean;
  /** Puts what was dragged down where it lands: moved or resized there, or added there. */
  commit(l: Lift, drop: Drop): void;
  /** Where an element is on screen (tests pass their own). */
  measure?(el: Element): Box;
  /** When where they would land changes (a haptic tick). */
  tick?(): void;
}

const ZERO = { x: 0, y: 0 };
const POINTER_EVENTS = ['pointermove', 'pointerup', 'pointercancel'] as const;
const onScreen = (el: Element): Box => el.getBoundingClientRect();
const landingKey = (d: Drop | null) =>
  d ? `${tabKey(d.at)} ${d.rects.map((r) => `${r.x},${r.y} ${r.w}×${r.h}`).join(' ')}` : '';

export class DragSession {
  /** What is being dragged, if anything. */
  lifted: Lift | null = $state(null);
  /** Where its pointer is now. */
  pointer: { x: number; y: number } | null = $state(null);
  /** The desk's widgets being dragged (none while a new one is brought in). */
  readonly carried: ReadonlySet<string> = $derived(
    new Set(this.lifted && this.lifted.kind !== 'add' ? this.lifted.ids : []),
  );
  /** Moved or brought in, not resized: each canvas draws where they would land, as ghosts. */
  readonly carrying = $derived(this.lifted?.kind === 'move' || this.lifted?.kind === 'add');
  /** How far the pointer moved since it went down: carried widgets follow it exactly. */
  readonly offset = $derived(
    this.lifted?.kind === 'move' && this.pointer
      ? { x: this.pointer.x - this.lifted.x0, y: this.pointer.y - this.lifted.y0 }
      : ZERO,
  );
  /**
   * Where what is dragged would land now: each canvas draws the ghosts of a move or an add on
   * itself; resized widgets show their new size themselves.
   */
  readonly drop: Drop | null = $derived.by(() => this.land());

  private targets: (() => DropTarget)[] = $state.raw([]);
  private unlisten: (() => void) | null = null;

  constructor(private readonly deps: Deps) {}

  /** Whether what is dragged may go on a tab. */
  accepts(l: Lift, at: TabRef): boolean {
    return this.deps.accepts(l, at);
  }

  /**
   * A canvas offers its grid while editing; the returned function takes it back. Read when the
   * drop is worked out, so it is always current. Never tracked: registering never re-runs
   * whoever registers.
   */
  register(get: () => DropTarget): () => void {
    untrack(() => (this.targets = [...this.targets, get]));
    return () => untrack(() => (this.targets = this.targets.filter((t) => t !== get)));
  }

  /** Starts dragging; refused while something else is dragged. */
  lift(l: Lift, x: number, y: number): boolean {
    if (untrack(() => this.lifted)) return false;
    this.lifted = l;
    this.pointer = { x, y };
    this.listen();
    return true;
  }

  /** The dragging pointer moved, came up (put down there) or was cancelled (put back). */
  follow(e: PointerNews) {
    const l = untrack(() => this.lifted);
    if (!l || e.pointerId !== l.pointerId) return;
    if (e.type === 'pointerup') {
      // Put down where it came up.
      this.pointer = { x: e.clientX, y: e.clientY };
      this.release();
    }
    // A mouse whose button came up outside the window: its up never arrived.
    else if (e.type === 'pointercancel' || (e.pointerType === 'mouse' && e.buttons === 0))
      this.cancel();
    else this.moveTo(e.clientX, e.clientY);
  }

  /** Puts the widgets back where they were (or adds nothing). */
  cancel() {
    untrack(() => this.stop());
  }

  /** A widget went away (deleted, its frame deleted, another desk shown): if dragged, the drag ends. */
  forget(id: string) {
    if (untrack(() => this.carried.has(id))) this.cancel();
  }

  private moveTo(x: number, y: number) {
    const before = landingKey(untrack(() => this.drop));
    this.pointer = { x, y };
    if (landingKey(untrack(() => this.drop)) !== before) this.deps.tick?.();
  }

  private release() {
    const { lifted, drop } = untrack(() => ({ lifted: this.lifted, drop: this.drop }));
    this.stop();
    if (lifted && drop?.valid) this.deps.commit(lifted, drop);
  }

  private stop() {
    this.unlisten?.();
    this.unlisten = null;
    this.lifted = null;
    this.pointer = null;
  }

  private listen() {
    if (typeof window === 'undefined') return;
    const follow = (e: PointerEvent) => this.follow(e);
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      this.cancel();
    };
    for (const type of POINTER_EVENTS) window.addEventListener(type, follow, true);
    window.addEventListener('keydown', escape, true);
    this.unlisten = () => {
      for (const type of POINTER_EVENTS) window.removeEventListener(type, follow, true);
      window.removeEventListener('keydown', escape, true);
    };
  }

  /**
   * Where what is dragged lands. Resized, the widgets stay in their grid, each grown or shrunk
   * alike. Moved: in the frame whose box the pointer is over (if they may all go there), else on
   * the desk, their top-left following the pointer from where they were in the grid they came
   * from. That grid is found by frame, not tab: their frame may show another tab by now, in the
   * same grid. A new widget lands the same way, held by its middle, but only while the pointer
   * is over the desk: let go anywhere else, nothing is added.
   */
  private land(): Drop | null {
    const l = this.lifted;
    const p = this.pointer;
    const targets = this.targets.map((get) => get());
    const desk = targets.find((t) => !t.at);
    if (!l || !p || !desk) return null;
    const measure = this.deps.measure ?? onScreen;
    const deskBox = measure(desk.element);
    const ground = (t: DropTarget, box: Box = measure(t.element)): Ground<TabRef> => ({
      at: t.at,
      box,
      grid: t.grid,
      metrics: t.metrics,
      items: t.widgets,
    });
    // The frames it may go into, each counting its whole box on the desk as over it.
    const frames = () =>
      targets
        .filter((t) => t.at && this.deps.accepts(l, t.at))
        .map((t) => {
          const frame = desk.widgets.find((w) => w.id === t.at!.widget);
          const px = frame && toPx(frame, desk.metrics);
          const hit = px && { ...px, left: deskBox.left + px.left, top: deskBox.top + px.top };
          return { ...ground(t), hit };
        });

    if (l.kind === 'add') {
      if (!within(deskBox, p.x, p.y)) return null;
      const item = { id: '', x: 0, y: 0, ...l.size };
      const middle = (g: Ground<TabRef>) => {
        const { width, height } = toPx(item, g.metrics);
        return { left: p.x - width / 2, top: p.y - height / 2 };
      };
      return landing([item], middle, p, ground(desk, deskBox), frames());
    }

    const items = l.rects();
    const from = targets.find((t) => (t.at?.widget ?? null) === (l.from?.widget ?? null));
    if (!from || items.length === 0) return null;
    if (l.kind !== 'move') {
      const { dCols, dRows } = pxToCells(p.x - l.x0, p.y - l.y0, from.metrics);
      const rects = resizeAll(items, l.kind, dCols, dRows, from.grid);
      return { at: l.from, rects, valid: allFree(rects, from.grid, from.widgets) };
    }
    const fromBox = from === desk ? deskBox : measure(from.element);
    const start = toPx(bounds(items), from.metrics);
    const at = {
      left: fromBox.left + start.left + p.x - l.x0,
      top: fromBox.top + start.top + p.y - l.y0,
    };
    return landing(items, () => at, p, ground(desk, deskBox), frames());
  }
}
