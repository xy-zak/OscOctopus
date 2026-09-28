// Input mapping: inbound OSC (batches from Rust's input hub) → widget values. For each batch:
//   1. find the bindings each message drives (routes.ts) and what it says (decodePatch);
//   2. coalesce: a continuous widget keeps only the newest message per binding; a discrete one
//      keeps every message, in order (at most MAX_DISCRETE per widget per batch);
//   3. compute each new value with the widget type's `input()`, and skip it while the local
//      user touches that widget, or when it is our own sent value coming back (expect.ts);
//   4. apply it through flow.ts (origin `input`). It is shown and shared, and forwarded only
//      if all of these hold: the binding forwards, forwarding is allowed there, the wire
//      output actually changed, and (for discrete widgets) the loop breaker agrees.
// `planBatch` is pure (receiver.test.ts); `startReceiver` wires it to Rust and to the desks.
import { input as inputIpc } from '../ipc/commands';
import type { Avoid, InboundMessage, InputBatch } from '../ipc/types';
import type { Binding, Preset, Widget } from '../model/preset';
import { forwardPolicy } from '../state/changes';
import { debugStore } from '../state/debug.svelte';
import { inputStore, type Outcome, type Received } from '../state/input.svelte';
import { presetStore } from '../state/preset.svelte';
import { isTouched } from '../state/touch';
import { values } from '../state/values.svelte';
import { errorText } from '../util';
import { gateFor, initialValue, inputValue, touchKeyOf } from '../widgets/defs';
import type { InputPatch } from '../widgets/types';
import { Breaker } from './breaker';
import { expectations, type Expectations } from './expect';
import { applyInput } from './flow';
import { decodePatch, forwardProblem, wireFingerprint } from './input';
import { RouteIndex } from './routes';
import type { WidgetValue } from './value';

/** At most this many messages per discrete widget are applied from one batch. */
const MAX_DISCRETE = 64;

export interface PlanDeps {
  index: RouteIndex;
  find(widgetId: string): { desk: Preset; widget: Widget } | undefined;
  current(widget: Widget): WidgetValue;
  isTouched(key: string): boolean;
  expect: Pick<Expectations, 'isOwnEcho'>;
  breaker: Pick<Breaker, 'allow'>;
  now: number;
  /** Whether this device forwards input for a desk (on a shared desk, only its forwarder). */
  mayForward(deskId: string): boolean;
}

export interface Apply {
  deskId: string;
  widget: Widget;
  value: WidgetValue;
  /** Set when the value is also sent to outputs: where it must not go back to. */
  forward: Avoid | null;
}

interface Hit {
  msg: InboundMessage;
  deskId: string;
  widget: Widget;
  binding: Binding;
  patch: InputPatch;
}

export function planBatch(
  messages: readonly InboundMessage[],
  deps: PlanDeps,
): { applies: Apply[]; outcomes: Map<number, Outcome[]>; received: Omit<Received, 'id'>[] } {
  const outcomes = new Map<number, Outcome[]>();
  const received: Omit<Received, 'id'>[] = [];
  const note = (seq: number, outcome: Outcome) => {
    const list = outcomes.get(seq) ?? [];
    list.push(outcome);
    outcomes.set(seq, list);
  };

  const hits: Hit[] = [];
  for (const msg of messages) {
    let matched = false;
    for (const { route, captures } of deps.index.lookup(msg.desk, msg.endpointId, msg.address)) {
      const found = deps.find(route.widgetId);
      const binding = found?.widget.bindings.find((b) => b.id === route.bindingId);
      if (!found || !binding) continue;
      const patch = decodePatch(found.widget, binding, msg.args, captures);
      if (!patch) continue;
      matched = true;
      hits.push({ msg, deskId: found.desk.id, widget: found.widget, binding, patch });
    }
    if (!matched) note(msg.seq, { result: 'no match' });
  }

  // Continuous widgets: only the newest message per binding counts.
  const newest = new Map<string, number>();
  hits.forEach((h, i) => {
    if (gateFor(h.widget).kind === 'throttle') newest.set(h.binding.id, i);
  });

  const applies: Apply[] = [];
  const discreteCount = new Map<string, number>();
  const currents = new Map<string, WidgetValue>();
  hits.forEach((hit, i) => {
    const { msg, widget, binding } = hit;
    const kind = gateFor(widget).kind;
    const record = (result: Outcome['result']) => {
      note(msg.seq, { result, widget: widget.label });
      received.push({ widgetId: widget.id, msg, result });
    };
    if (kind === 'throttle' && newest.get(binding.id) !== i) return record('coalesced');
    if (kind !== 'throttle') {
      const n = (discreteCount.get(widget.id) ?? 0) + 1;
      discreteCount.set(widget.id, n);
      if (n > MAX_DISCRETE) return record('dropped');
    }
    const current = currents.get(widget.id) ?? deps.current(widget);
    const next = inputValue(widget, hit.patch, current);
    if (next === null) return record('ignored');
    if (deps.isTouched(touchKeyOf(widget, next))) return record('touched');
    if (deps.expect.isOwnEcho(widget, next)) return record('own echo');

    let forward: Avoid | null = null;
    let result: Outcome['result'] = 'applied';
    const wantsForward =
      binding.forward &&
      !forwardProblem(widget) &&
      deps.mayForward(hit.deskId) &&
      wireFingerprint(widget, current) !== wireFingerprint(widget, next);
    if (wantsForward) {
      if (kind !== 'queue' || deps.breaker.allow(widget.id, deps.now)) {
        forward = { endpointId: msg.endpointId, remote: msg.remote };
        result = 'forwarded';
      } else {
        result = 'forward stopped';
      }
    }
    currents.set(widget.id, next);
    applies.push({ deskId: hit.deskId, widget, value: next, forward });
    record(result);
  });
  return { applies, outcomes, received };
}

// ---- wiring ------------------------------------------------------------------------------

const breaker = new Breaker((widgetId) => {
  inputStore.tripped[widgetId] = true;
  const label = presetStore.findWidget(widgetId)?.widget.label ?? widgetId;
  debugStore.local(
    `forwarding stopped for ${label}: its messages kept coming back (a loop?). Re-arm it in the widget's info panel.`,
    widgetId,
    'input',
  );
});

let index = new RouteIndex([]);
let started = false;
/** deskId → the listen set last pushed to Rust. */
const pushed = new Map<string, string>();

/** Lets a widget whose forwarding the breaker stopped forward again. */
export function rearmForward(widgetId: string) {
  breaker.rearm(widgetId);
  delete inputStore.tripped[widgetId];
}

function pushListen(next: RouteIndex) {
  for (const desk of new Set([...pushed.keys(), ...next.listen.keys()])) {
    const ids = next.listen.get(desk) ?? [];
    const key = ids.join('\u0000');
    if ((pushed.get(desk) ?? '') === key) continue;
    if (ids.length) pushed.set(desk, key);
    else pushed.delete(desk);
    inputIpc
      .setListen(desk, ids)
      .catch((e) => debugStore.local(`input listen failed: ${errorText(e)}`, undefined, 'input'));
  }
}

function handle(batch: InputBatch) {
  inputStore.totalDropped = batch.totalDropped;
  const { applies, outcomes, received } = planBatch(batch.messages, {
    index,
    find: (id) => presetStore.findWidget(id),
    current: (w) => values[w.id] ?? initialValue(w),
    isTouched,
    expect: expectations,
    breaker,
    now: performance.now(),
    mayForward: (deskId) => forwardPolicy.mayForward(deskId),
  });
  for (const a of applies) applyInput(a.deskId, a.widget, a.value, a.forward);
  inputStore.record(outcomes, received);
}

/** Subscribes to Rust's input hub and keeps the routes in step with the desks. Idempotent. */
export async function startReceiver() {
  if (started) return;
  started = true;
  $effect.root(() => {
    $effect(() => {
      index = new RouteIndex(presetStore.desks);
      pushListen(index);
    });
  });
  await inputIpc.subscribe(handle);
}
