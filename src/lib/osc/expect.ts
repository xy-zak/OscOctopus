// Own-echo cancellation. Many devices send every value they receive straight back (a mixer
// confirming a fader move). Without this, a late echo of a mid-drag value would yank the
// fader back, and two apps bridging each other could ping-pong stale values.
//
// For each widget we remember the values that actually went out (up to KEEP_MAX, for
// KEEP_MS). An incoming value that matches one of them is our own coming back: it is ignored,
// and everything sent before it is forgotten (the device has caught up). A value that matches
// nothing is genuinely new: it is applied, and the memory is cleared (the device diverged, so
// it is trusted from then on). Numbers match within the widget's `echoTolerance`.
import type { Widget } from '../model/preset';
import { echoToleranceOf } from '../widgets/defs';
import { isRecord, type WidgetValue } from './value';

const KEEP_MS = 1500;
const KEEP_MAX = 32;

interface Sent {
  value: WidgetValue;
  at: number;
}

const pick = (v: WidgetValue, key: string) =>
  isRecord(v) ? v[key] : key === 'value' ? v : undefined;

function same(a: WidgetValue, b: WidgetValue, tolerance: Record<string, number>): boolean {
  return Object.entries(tolerance).every(([key, tol]) => {
    const x = pick(a, key);
    const y = pick(b, key);
    return typeof x === 'number' && typeof y === 'number' ? Math.abs(x - y) <= tol + 1e-9 : x === y;
  });
}

export class Expectations {
  private sent = new Map<string, Sent[]>();

  constructor(private readonly now: () => number = () => performance.now()) {}

  /** A value of `widget` really went out. */
  note(widget: Widget, value: WidgetValue) {
    const list = this.fresh(widget.id);
    list.push({ value, at: this.now() });
    if (list.length > KEEP_MAX) list.shift();
    this.sent.set(widget.id, list);
  }

  /** Whether `value` is one we sent coming back (then it and everything before it are forgotten). */
  isOwnEcho(widget: Widget, value: WidgetValue): boolean {
    const list = this.fresh(widget.id);
    if (list.length === 0) return false;
    const tolerance = echoToleranceOf(widget);
    const i = list.findIndex((s) => same(s.value, value, tolerance));
    if (i < 0) {
      this.sent.delete(widget.id);
      return false;
    }
    list.splice(0, i + 1);
    return true;
  }

  private fresh(widgetId: string): Sent[] {
    const cutoff = this.now() - KEEP_MS;
    const list = (this.sent.get(widgetId) ?? []).filter((s) => s.at >= cutoff);
    if (list.length) this.sent.set(widgetId, list);
    else this.sent.delete(widgetId);
    return list;
  }
}

export const expectations = new Expectations();
