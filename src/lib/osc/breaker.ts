// The forward loop breaker. Forwarding received input re-sends it; if a device (or another
// app) sends it straight back, and that is forwarded again, the two ping-pong. Continuous
// widgets are already bounded by their rate limit, so this guards discrete ones: more than
// `limit` forwards within `windowMs` trips it, which stops forwarding for that widget until the
// user re-arms it. Tested in receiver.test.ts.

export class Breaker {
  readonly tripped = new Set<string>();
  private times = new Map<string, number[]>();

  constructor(
    private readonly onTrip: (widgetId: string) => void = () => {},
    private readonly limit = 40,
    private readonly windowMs = 1000,
  ) {}

  /** Whether `widgetId` may forward now (counts the forward if so). */
  allow(widgetId: string, now: number): boolean {
    if (this.tripped.has(widgetId)) return false;
    const recent = (this.times.get(widgetId) ?? []).filter((t) => now - t < this.windowMs);
    recent.push(now);
    if (recent.length <= this.limit) {
      this.times.set(widgetId, recent);
      return true;
    }
    this.times.delete(widgetId);
    this.tripped.add(widgetId);
    this.onTrip(widgetId);
    return false;
  }

  rearm(widgetId: string) {
    this.tripped.delete(widgetId);
  }
}
