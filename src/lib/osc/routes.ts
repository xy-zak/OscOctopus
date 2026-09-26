// Which widget messages listen where: an index from (desk, endpoint, address) to the bindings
// that receive it. It is rebuilt whenever the desks change, and also yields the endpoints each
// desk listens on (Rust only forwards messages from those). Pure; tested in receiver.test.ts.
import type { Preset } from '../model/preset';
import { compileAddress, isPattern, matchAddress, oscPattern, receiveProblem } from './input';

export interface Route {
  deskId: string;
  widgetId: string;
  bindingId: string;
}

export interface RouteMatch {
  route: Route;
  /** Channel values captured from the address by `{placeholders}`. */
  captures: Record<string, string>;
}

interface EndpointRoutes {
  /** Literal addresses. */
  exact: Map<string, Route[]>;
  /** Templates with placeholders. */
  templated: {
    route: Route;
    compiled: Extract<ReturnType<typeof compileAddress>, { kind: 'template' }>;
  }[];
}

/** An incoming wildcard address may match at most this many routes. */
const MAX_PATTERN_FANOUT = 64;

export class RouteIndex {
  private byEndpoint = new Map<string, EndpointRoutes>();
  /** deskId → endpoint ids a widget listens on. */
  readonly listen = new Map<string, string[]>();

  constructor(desks: readonly Preset[]) {
    for (const desk of desks) {
      const listened = new Set<string>();
      for (const widget of desk.widgets) {
        for (const binding of widget.bindings) {
          if (!binding.receive || receiveProblem(widget, binding)) continue;
          const route = { deskId: desk.id, widgetId: widget.id, bindingId: binding.id };
          const compiled = compileAddress(binding.address);
          for (const source of binding.sourceIds) {
            listened.add(source);
            const entry = this.entry(desk.id, source);
            if (compiled.kind === 'literal') {
              const list = entry.exact.get(compiled.address) ?? [];
              list.push(route);
              entry.exact.set(compiled.address, list);
            } else if (compiled.kind === 'template') {
              entry.templated.push({ route, compiled });
            }
          }
        }
      }
      if (listened.size) this.listen.set(desk.id, [...listened].sort());
    }
  }

  private entry(deskId: string, endpointId: string): EndpointRoutes {
    const key = `${deskId}\u0000${endpointId}`;
    let entry = this.byEndpoint.get(key);
    if (!entry) this.byEndpoint.set(key, (entry = { exact: new Map(), templated: [] }));
    return entry;
  }

  /**
   * The bindings a message on this endpoint drives. A wildcard address (an OSC pattern)
   * matches literal routes only: it can't supply a value for a placeholder.
   */
  lookup(deskId: string, endpointId: string, address: string): RouteMatch[] {
    const entry = this.byEndpoint.get(`${deskId}\u0000${endpointId}`);
    if (!entry) return [];
    if (isPattern(address)) {
      const re = oscPattern(address);
      if (!re) return [];
      const out: RouteMatch[] = [];
      for (const [literal, routes] of entry.exact) {
        if (!re.test(literal)) continue;
        for (const route of routes) out.push({ route, captures: {} });
        if (out.length >= MAX_PATTERN_FANOUT) break;
      }
      return out.slice(0, MAX_PATTERN_FANOUT);
    }
    const out: RouteMatch[] = (entry.exact.get(address) ?? []).map((route) => ({
      route,
      captures: {},
    }));
    for (const { route, compiled } of entry.templated) {
      const captures = matchAddress(compiled, address);
      if (captures) out.push({ route, captures });
    }
    return out;
  }
}
