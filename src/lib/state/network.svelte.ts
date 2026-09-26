// Mirrors endpoint status from Rust and pushes each desk's network config to it. Endpoints
// are namespaced by desk (an open preset), so status is keyed by desk + endpoint id.
import { net } from '../ipc/commands';
import { onNetStatus } from '../ipc/events';
import type { EndpointStatus, NetInterface, NetworkConfig } from '../ipc/types';
import { errorText } from '../util';
import { debugStore } from './debug.svelte';

export interface Rates {
  txPps: number;
  rxPps: number;
  txBps: number;
  rxBps: number;
}

const POLL_MS = 1000;

/** How applying a desk's network config went. */
export interface ApplyState {
  applying: boolean;
  error: string | null;
  at: number | null;
}
const NOT_APPLIED: ApplyState = { applying: false, error: null, at: null };

/** Status-map key for an endpoint of a desk. */
export const epKey = (desk: string, id: string) => `${desk}\u0000${id}`;
const keyOf = (s: EndpointStatus) => epKey(s.desk, s.id);

class NetworkStore {
  statuses: Record<string, EndpointStatus> = $state.raw({});
  rates: Record<string, Rates> = $state.raw({});
  interfaces: NetInterface[] = $state.raw([]);
  /** Global output gate, mirrored from Rust (which enforces it). */
  paused = $state(false);
  /** Per desk. */
  applyStates: Record<string, ApplyState> = $state({});

  private applyTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private applying = new Map<string, number>();
  private prev: { at: number; stats: Record<string, EndpointStatus['stats']> } | null = null;
  private started = false;

  async start() {
    if (this.started) return;
    this.started = true;
    await onNetStatus((s) => (this.statuses = { ...this.statuses, [keyOf(s)]: s }));
    this.paused = await net.paused();
    setInterval(() => void this.poll(), POLL_MS);
    await this.refreshInterfaces();
  }

  status(desk: string, id: string): EndpointStatus | undefined {
    return this.statuses[epKey(desk, id)];
  }

  rate(desk: string, id: string): Rates | undefined {
    return this.rates[epKey(desk, id)];
  }

  /** Every status of one desk. */
  forDesk(desk: string): EndpointStatus[] {
    return Object.values(this.statuses).filter((s) => s.desk === desk);
  }

  private setAll(list: EndpointStatus[]) {
    this.statuses = Object.fromEntries(list.map((s) => [keyOf(s), s]));
  }

  /** Counters come from Rust, so rates stay correct even if debug events were dropped. */
  private async poll() {
    try {
      const list = await net.status();
      const now = performance.now();
      const stats = Object.fromEntries(list.map((s) => [keyOf(s), s.stats]));
      if (this.prev) {
        const dt = (now - this.prev.at) / 1000;
        const rates: Record<string, Rates> = {};
        for (const s of list) {
          const p = this.prev.stats[keyOf(s)];
          if (!p || dt <= 0) continue;
          rates[keyOf(s)] = {
            txPps: (s.stats.txPackets - p.txPackets) / dt,
            rxPps: (s.stats.rxPackets - p.rxPackets) / dt,
            txBps: (s.stats.txBytes - p.txBytes) / dt,
            rxBps: (s.stats.rxBytes - p.rxBytes) / dt,
          };
        }
        this.rates = rates;
      }
      this.prev = { at: now, stats };
      this.setAll(list);
    } catch (e) {
      debugStore.local(`net_status failed: ${errorText(e)}`);
    }
  }

  async refreshInterfaces() {
    try {
      this.interfaces = await net.listInterfaces();
    } catch (e) {
      debugStore.local(`listing interfaces failed: ${errorText(e)}`);
    }
  }

  applyState(desk: string): ApplyState {
    return this.applyStates[desk] ?? NOT_APPLIED;
  }

  async apply(desk: string, config: NetworkConfig) {
    clearTimeout(this.applyTimers.get(desk));
    // Applies of one desk can overlap (Rust runs them in order); count them per desk.
    this.applying.set(desk, (this.applying.get(desk) ?? 0) + 1);
    const prev = this.applyState(desk);
    this.applyStates[desk] = { ...prev, applying: true };
    try {
      this.setAll(await net.applyConfig(desk, config));
      this.applyStates[desk] = { applying: true, error: null, at: Date.now() };
    } catch (e) {
      const error = errorText(e);
      this.applyStates[desk] = { ...this.applyState(desk), error };
      debugStore.local(`applying network config failed: ${error}`, undefined, 'network');
    } finally {
      const left = (this.applying.get(desk) ?? 1) - 1;
      this.applying.set(desk, left);
      this.applyStates[desk] = { ...this.applyState(desk), applying: left > 0 };
    }
  }

  /** Debounced apply for edits made while typing. */
  scheduleApply(desk: string, config: () => NetworkConfig, delay = 300) {
    clearTimeout(this.applyTimers.get(desk));
    this.applyTimers.set(
      desk,
      setTimeout(() => void this.apply(desk, config()), delay),
    );
  }

  async closeDesk(desk: string) {
    clearTimeout(this.applyTimers.get(desk));
    this.applyTimers.delete(desk);
    this.applying.delete(desk);
    delete this.applyStates[desk];
    try {
      this.setAll(await net.closeDesk(desk));
    } catch (e) {
      debugStore.local(`closing desk network failed: ${errorText(e)}`, undefined, 'network');
    }
  }

  async setPaused(paused: boolean) {
    try {
      this.paused = await net.setPaused(paused);
    } catch (e) {
      debugStore.local(`pause failed: ${errorText(e)}`, undefined, 'network');
    }
  }
}

export const networkStore = new NetworkStore();
