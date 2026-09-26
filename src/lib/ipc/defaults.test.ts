import { describe, expect, it } from 'vitest';
import { newInput, newOutput } from '../model/factory';
import { InputConfigSchema, OutputConfigSchema } from '../model/preset';
import { INPUT_DEFAULTS, OUTPUT_DEFAULTS } from './defaults';

describe('Rust-owned endpoint defaults (bindings/defaults.json)', () => {
  it('are valid endpoint configs once given an id', () => {
    expect(OutputConfigSchema.safeParse({ ...OUTPUT_DEFAULTS, id: 'o' }).success).toBe(true);
    expect(InputConfigSchema.safeParse({ ...INPUT_DEFAULTS, id: 'i' }).success).toBe(true);
  });

  it('are what new endpoints start from', () => {
    expect(newOutput()).toEqual({
      ...OUTPUT_DEFAULTS,
      id: expect.stringMatching(/^out-/),
      name: 'New output',
    });
    expect(newInput({ port: 9100 })).toEqual({
      ...INPUT_DEFAULTS,
      id: expect.stringMatching(/^in-/),
      name: 'New input',
      port: 9100,
    });
  });
});
