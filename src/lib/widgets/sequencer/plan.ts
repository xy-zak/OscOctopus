// A sequencer widget as the plan the Rust core plays (src-tauri/src/sequencer.rs). Pure; tested
// in plan.test.ts.
import { SEQUENCER_LIMITS } from '../../ipc/defaults';
import type { SeqPlan } from '../../ipc/types';
import type { SeqStep, SequencerWidget } from '../../model/preset';
import { addressError, constArg } from '../../osc/mapping';

export function toPlan(w: SequencerWidget): SeqPlan {
  const p = w.props;
  return {
    outputIds: [...p.outputIds],
    steps: p.steps.map((s) => ({
      id: s.id,
      message: { address: s.address, args: s.args.map(constArg) },
      delayMs: s.delayMs,
    })),
    count: p.repeat === 'count' ? p.count : null,
  };
}

/** Why the sequence can't start (Rust would refuse it too), or null. */
export function startProblem(w: SequencerWidget): string | null {
  if (w.props.outputIds.length === 0) return 'choose an output to send to';
  for (const [i, s] of w.props.steps.entries()) {
    const err = addressError(s.address);
    if (err) return `step ${i + 1}: the address ${err}`;
  }
  return null;
}

/**
 * How long one pass takes: the sum of its waits, but never less than the floor Rust holds a
 * pass to, so a sequence of zero waits can't flood the outputs.
 */
export function passMs(steps: readonly Pick<SeqStep, 'delayMs'>[]): {
  ms: number;
  floored: boolean;
} {
  const waits = steps.reduce((t, s) => t + s.delayMs, 0);
  const floor = Math.max(
    SEQUENCER_LIMITS.minPassMs,
    SEQUENCER_LIMITS.minPassMsPerStep * steps.length,
  );
  return { ms: Math.max(waits, floor), floored: waits < floor };
}
