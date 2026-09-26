// Live values on shared desks. Every widget's value is a last-writer-wins register stamped by
// the hybrid clock, keyed like touches: the widget id, or `widget#pad` for each pad of a pads
// widget, so toggled pads agree across devices. Rules:
//   - changes made here (touch, or matched OSC input) are sent, coalesced to ≤30 Hz; discrete
//     presses go at once. Everything is sent again every 2 s, which repairs dropped values;
//   - while PAUSED, this device's touches are not shared: peers must never show a value the
//     device never got;
//   - a newer value from a peer always updates the register, but is only *shown* once you stop
//     touching that widget (or pad). Then the winner is shown, so everyone converges;
//   - peers' values are only ever shown (state/live.ts). Nothing here sends OSC.
import type { Widget } from '../model/preset';
import type { WidgetValue } from '../osc/value';
import type { LocalValueChange } from '../state/changes';
import { gateFor, isValueFor, touchKeyOf } from '../widgets/defs';
import { newer, type Hlc } from './hlc';
import type { Stamp, Values, WireRegister } from './protocol';

export const FLUSH_MS = 33;
export const REFRESH_MS = 2000;
const UNMASK_MS = 100;

/** A shared desk as values see it. */
export interface ValueDesk {
  doc: string;
  widgets: readonly Widget[];
}

export interface ValueDeps {
  clock(): Hlc | null;
  /** A shared desk that is open and live here. */
  desk(deskId: string): ValueDesk | undefined;
  broadcast(deskId: string, body: Values): void;
  isTouched(key: string): boolean;
  show(widget: Widget, value: WidgetValue, origin: 'peer' | 'init'): void;
  paused(): boolean;
  /** A peer's stamp was too far ahead of this device's clock (its value was ignored). */
  clockSkew(peer: string, aheadMs: number): void;
}

interface Register {
  stamp: Stamp;
  value: WidgetValue;
}

function widgetOf(desk: ValueDesk, key: string): Widget | undefined {
  const id = key.split('#')[0];
  return desk.widgets.find((w) => w.id === id);
}

export class LiveValues {
  private regs = new Map<string, Map<string, Register>>();
  private pending = new Map<string, Set<string>>();
  /** Shown once no longer touched: desk → key → origin. */
  private masked = new Map<string, Map<string, 'peer' | 'init'>>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private unmaskTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private deps: ValueDeps) {}

  private registers(deskId: string): Map<string, Register> {
    let m = this.regs.get(deskId);
    if (!m) this.regs.set(deskId, (m = new Map()));
    return m;
  }

  /** A value changed on this device. */
  local(change: LocalValueChange) {
    const desk = this.deps.desk(change.deskId);
    const clock = this.deps.clock();
    if (!desk || !clock) return;
    if (change.origin === 'touch' && this.deps.paused()) return;
    const widget = desk.widgets.find((w) => w.id === change.widgetId);
    if (!widget) return;
    const key = touchKeyOf(widget, change.value);
    this.registers(change.deskId).set(key, { stamp: clock.now(), value: change.value });
    let keys = this.pending.get(change.deskId);
    if (!keys) this.pending.set(change.deskId, (keys = new Set()));
    keys.add(key);
    // A press is an event: sent at once. Continuous gestures are coalesced.
    if (change.origin === 'touch' && gateFor(widget).kind === 'queue') this.flush();
    else this.flushTimer ??= setTimeout(() => this.flush(), FLUSH_MS);
  }

  /** Values from a peer (a Values message, or the values in a desk's full state). */
  receive(peer: string, deskId: string, body: Values, origin: 'peer' | 'init' = 'peer') {
    const desk = this.deps.desk(deskId);
    const clock = this.deps.clock();
    if (!desk || !clock || desk.doc !== body.doc) return;
    const regs = this.registers(deskId);
    for (const [key, stamp, value] of body.regs) {
      const widget = widgetOf(desk, key);
      // The key must be the one the value itself names (a pad's number), and in range.
      if (!widget || !isValueFor(widget, value) || touchKeyOf(widget, value) !== key) continue;
      if (!newer(stamp, regs.get(key)?.stamp)) continue;
      if (!clock.observe(stamp)) {
        this.deps.clockSkew(peer, clock.aheadBy(stamp));
        continue;
      }
      regs.set(key, { stamp, value });
      if (this.deps.isTouched(key)) this.mask(deskId, key, origin);
      else this.deps.show(widget, value, origin);
    }
  }

  private mask(deskId: string, key: string, origin: 'peer' | 'init') {
    let m = this.masked.get(deskId);
    if (!m) this.masked.set(deskId, (m = new Map()));
    m.set(key, origin);
    this.unmaskTimer ??= setTimeout(() => this.unmask(), UNMASK_MS);
  }

  /** Shows values that arrived while their widget was touched, once it no longer is. */
  private unmask() {
    this.unmaskTimer = null;
    for (const [deskId, keys] of this.masked) {
      const desk = this.deps.desk(deskId);
      if (!desk) {
        this.masked.delete(deskId);
        continue;
      }
      for (const [key, origin] of keys) {
        if (this.deps.isTouched(key)) continue;
        keys.delete(key);
        const reg = this.regs.get(deskId)?.get(key);
        const widget = widgetOf(desk, key);
        if (reg && widget && isValueFor(widget, reg.value))
          this.deps.show(widget, reg.value, origin);
      }
      if (keys.size === 0) this.masked.delete(deskId);
    }
    if (this.masked.size > 0) this.unmaskTimer = setTimeout(() => this.unmask(), UNMASK_MS);
  }

  /** Sends what changed here since the last flush. */
  flush() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    for (const [deskId, keys] of this.pending) {
      const desk = this.deps.desk(deskId);
      const regs = this.regs.get(deskId);
      if (desk && regs) {
        const out: WireRegister[] = [];
        for (const key of keys) {
          const r = regs.get(key);
          if (r) out.push([key, r.stamp, r.value]);
        }
        if (out.length) this.deps.broadcast(deskId, { doc: desk.doc, regs: out });
      }
    }
    this.pending.clear();
  }

  /** Every register of a desk (for its full state, and the periodic refresh). */
  snapshot(deskId: string): WireRegister[] {
    return [...(this.regs.get(deskId) ?? [])].map(([k, r]) => [k, r.stamp, r.value]);
  }

  /** Sends every register of every live shared desk again. */
  refresh() {
    for (const deskId of this.regs.keys()) {
      const desk = this.deps.desk(deskId);
      const regs = this.snapshot(deskId);
      if (desk && regs.length) this.deps.broadcast(deskId, { doc: desk.doc, regs });
    }
  }

  forget(deskId: string) {
    this.regs.delete(deskId);
    this.pending.delete(deskId);
    this.masked.delete(deskId);
  }
}
