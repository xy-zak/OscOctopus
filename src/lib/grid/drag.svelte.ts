// One drag at a time across a desk's grids: the desk's own and the shown tab of each frame on it
// (docs/ARCHITECTURE.md › Frames). Each canvas registers while editing. Once a widget is lifted
// (GridItem.svelte, past the tap slop), the session follows that pointer itself, through window
// listeners, works out where the widget would land (engine.ts `landing`) and commits a valid drop.
// So the widget can be drawn again elsewhere mid-drag (its frame showing another tab) without the
// drag ending.
import { untrack } from 'svelte';
import type { TabRef } from '../model/preset';
import { tabKey } from '../model/tabs';
import {
  landing,
  toPx,
  type Box,
  type Ground,
  type GridSize,
  type Landing,
  type Metrics,
  type Placed,
  type Rect,
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

/** The widget being carried. */
export interface Lift {
  id: string;
  /** The tab it was lifted from; null: the desk. */
  from: TabRef | null;
  pointerId: number;
  /** Where the pointer was when it went down. */
  x0: number;
  y0: number;
  /** Where the widget is in its grid (read live). */
  rect: () => Rect;
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
  /** Whether a widget may go on a tab (model/tabs.ts `canPlace`). */
  accepts(id: string, at: TabRef): boolean;
  /** Puts a widget down at `rect` in the grid of `at` (null: the desk). */
  commit(id: string, rect: Rect, at: TabRef | null): void;
  /** Where an element is on screen (tests pass their own). */
  measure?(el: Element): Box;
  /** When where it would land changes (a haptic tick). */
  tick?(): void;
}

const ZERO = { x: 0, y: 0 };
const POINTER_EVENTS = ['pointermove', 'pointerup', 'pointercancel'] as const;
const onScreen = (el: Element): Box => el.getBoundingClientRect();
const landingKey = (d: Drop | null) =>
  d ? `${tabKey(d.at)} ${d.rect.x},${d.rect.y} ${d.rect.w}×${d.rect.h}` : '';

export class DragSession {
  /** The widget being carried, if any. */
  lifted: Lift | null = $state(null);
  /** Where its pointer is now. */
  pointer: { x: number; y: number } | null = $state(null);
  /** How far the pointer moved since it went down: the carried widget follows it exactly. */
  readonly offset = $derived(
    this.lifted && this.pointer
      ? { x: this.pointer.x - this.lifted.x0, y: this.pointer.y - this.lifted.y0 }
      : ZERO,
  );
  /** Where the carried widget would land now (each canvas draws the ghost on itself). */
  readonly drop: Drop | null = $derived.by(() => this.land());

  private targets: (() => DropTarget)[] = $state.raw([]);
  private unlisten: (() => void) | null = null;

  constructor(private readonly deps: Deps) {}

  /** Whether a widget may go on a tab. */
  accepts(id: string, at: TabRef): boolean {
    return this.deps.accepts(id, at);
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

  /** Starts carrying a widget; refused while another is carried. */
  lift(l: Lift, x: number, y: number): boolean {
    if (untrack(() => this.lifted)) return false;
    this.lifted = l;
    this.pointer = { x, y };
    this.listen();
    return true;
  }

  /** The carried pointer moved, came up (put down there) or was cancelled (put back). */
  follow(e: PointerNews) {
    const l = untrack(() => this.lifted);
    if (!l || e.pointerId !== l.pointerId) return;
    if (e.type === 'pointerup') this.release();
    // A mouse whose button came up outside the window: its up never arrived.
    else if (e.type === 'pointercancel' || (e.pointerType === 'mouse' && e.buttons === 0))
      this.cancel();
    else this.moveTo(e.clientX, e.clientY);
  }

  /** Puts the widget back where it was. */
  cancel() {
    untrack(() => this.stop());
  }

  /** A widget went away (deleted, its frame deleted, another desk shown): if carried, the drag ends. */
  forget(id: string) {
    if (untrack(() => this.lifted?.id) === id) this.cancel();
  }

  private moveTo(x: number, y: number) {
    const before = landingKey(untrack(() => this.drop));
    this.pointer = { x, y };
    if (landingKey(untrack(() => this.drop)) !== before) this.deps.tick?.();
  }

  private release() {
    const { lifted, drop } = untrack(() => ({ lifted: this.lifted, drop: this.drop }));
    this.stop();
    if (lifted && drop?.valid) this.deps.commit(lifted.id, drop.rect, drop.at);
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
   * Where the carried widget lands: in the frame whose box the pointer is over (if it may go
   * there), else on the desk. Its top-left follows the pointer from where it was in the grid it
   * came from, found by frame, not tab: its frame may show another tab by now, in the same grid.
   */
  private land(): Drop | null {
    const l = this.lifted;
    const p = this.pointer;
    if (!l || !p) return null;
    const measure = this.deps.measure ?? onScreen;
    const targets = this.targets.map((get) => get());
    const desk = targets.find((t) => !t.at);
    const from = targets.find((t) => (t.at?.widget ?? null) === (l.from?.widget ?? null));
    if (!desk || !from) return null;
    const deskBox = measure(desk.element);
    const ground = (t: DropTarget, box: Box = measure(t.element)): Ground<TabRef> => ({
      at: t.at,
      box,
      grid: t.grid,
      metrics: t.metrics,
      items: t.widgets,
    });
    const frames = targets
      .filter((t) => t.at && this.deps.accepts(l.id, t.at))
      .map((t) => {
        const frame = desk.widgets.find((w) => w.id === t.at!.widget);
        const px = frame && toPx(frame, desk.metrics);
        const hit = px && { ...px, left: deskBox.left + px.left, top: deskBox.top + px.top };
        return { ...ground(t), hit };
      });
    const rect = l.rect();
    const fromBox = from === desk ? deskBox : measure(from.element);
    const start = toPx(rect, from.metrics);
    const left = fromBox.left + start.left + p.x - l.x0;
    const top = fromBox.top + start.top + p.y - l.y0;
    return landing({ id: l.id, ...rect }, left, top, p, ground(desk, deskBox), frames);
  }
}
