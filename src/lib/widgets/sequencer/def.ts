// A sequencer: messages played in a loop by the Rust core (src-tauri/src/sequencer.rs), each
// followed by its wait. It has no messages of its own and nothing to share: its value is how
// its run is going on this device (state/sequencer.svelte.ts writes it, never flow.ts), so a
// sequence only ever plays on the device that started it.
import { canonical } from '../../canonical';
import { uid } from '../../model/parts';
import type { SeqStep, SequencerWidget } from '../../model/preset';
import type { ValueRecord } from '../../osc/value';
import type { WidgetDef } from '../types';

/** How a run is going: `step` counts from 1 (0 before the first), `pass` too. */
export type SeqValue = ValueRecord & {
  state: 'stopped' | 'running' | 'paused';
  step: number;
  pass: number;
};

export const STOPPED: SeqValue = { state: 'stopped', step: 0, pass: 0 };

/** A step sending `n` to `address`, then waiting `delayMs`. */
export function newStep(address: string, n: number, delayMs: number): SeqStep {
  return { id: uid('s'), address, args: [{ kind: 'const', type: 'i', value: String(n) }], delayMs };
}

export const sequencerDef: WidgetDef<SequencerWidget> = {
  label: 'Sequencer',
  defaultSize: { w: 3, h: 2 },
  create: (base, n, outputIds) => ({
    ...base,
    type: 'sequencer',
    label: `Sequencer ${n}`,
    bindings: [],
    props: {
      outputIds,
      steps: [1, 2, 3, 4].map((i) => newStep(`/octopus/seq/${n}`, i, 500)),
      repeat: 'forever',
      count: 1,
    },
  }),
  initialValue: () => ({ ...STOPPED }),
  channels: () => [
    { id: 'state', hint: 'stopped, running or paused' },
    { id: 'step', hint: 'the step sent last, from 1' },
    { id: 'pass', hint: 'the pass it is in, from 1' },
  ],
  gate: () => ({ kind: 'queue' }),
  input: () => null,
  echoTolerance: () => ({}),
  // A run is this device's own: a peer's value is never shown.
  isValue: (_w, v): v is SeqValue => canonical(v) === canonical(STOPPED),
  messages: () => 'none',
  outputRefs: (w) => w.props.outputIds,
  dropOutput: (w, id) => {
    w.props.outputIds = w.props.outputIds.filter((o) => o !== id);
  },
};
