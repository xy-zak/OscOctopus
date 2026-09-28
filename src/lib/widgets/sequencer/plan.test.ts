import { describe, expect, it } from 'vitest';
import { newWidget } from '../defs';
import { passMs, startProblem, toPlan } from './plan';

const rect = { x: 0, y: 0, w: 3, h: 2 };

describe('sequencer plan', () => {
  it('sends each step’s fixed arguments as typed OSC, to the widget’s outputs', () => {
    const w = newWidget('sequencer', rect, ['out-1']);
    w.props.steps[0]!.args = [
      { kind: 'const', type: 'f', value: '0.5' },
      { kind: 'const', type: 's', value: 'go' },
      { kind: 'const', type: 'i', value: 'nope' },
      { kind: 'const', type: 'T', value: '' },
    ];
    const plan = toPlan(w);
    expect(plan.outputIds).toEqual(['out-1']);
    expect(plan.count).toBeNull();
    expect(plan.steps).toHaveLength(4);
    expect(plan.steps[0]).toEqual({
      id: w.props.steps[0]!.id,
      message: {
        address: '/octopus/seq/1',
        args: [
          { type: 'f', value: 0.5 },
          { type: 's', value: 'go' },
          { type: 'i', value: 0 },
          { type: 'T' },
        ],
      },
      delayMs: 500,
    });
  });

  it('plays count passes only when asked to', () => {
    const w = newWidget('sequencer', rect, ['out-1']);
    w.props.count = 3;
    expect(toPlan(w).count).toBeNull();
    w.props.repeat = 'count';
    expect(toPlan(w).count).toBe(3);
  });

  it('says why it can’t start', () => {
    const w = newWidget('sequencer', rect, []);
    expect(startProblem(w)).toMatch(/output/);
    w.props.outputIds = ['out-1'];
    expect(startProblem(w)).toBeNull();
    w.props.steps[1]!.address = 'no slash';
    expect(startProblem(w)).toMatch(/^step 2/);
  });

  it('holds a pass to the floor Rust plays it at', () => {
    expect(passMs([{ delayMs: 500 }, { delayMs: 250 }])).toEqual({ ms: 750, floored: false });
    expect(passMs([{ delayMs: 0 }, { delayMs: 3 }])).toEqual({ ms: 10, floored: true });
    expect(passMs(Array.from({ length: 64 }, () => ({ delayMs: 0 })))).toEqual({
      ms: 64,
      floored: true,
    });
  });
});
