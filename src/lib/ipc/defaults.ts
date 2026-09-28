// Endpoint defaults and the sequencer's limits, owned by Rust (`impl Default for OutputConfig /
// InputConfig`, `sequencer::LIMITS`) and written next to the generated types by
// `npm run bindings`, so the two sides can't drift.
import defaults from './bindings/defaults.json';
import type { InputConfig, OutputConfig } from './types';

// JSON imports widen string literals; defaults.test.ts validates the file against the schemas.
export const OUTPUT_DEFAULTS = defaults.output as OutputConfig;
export const INPUT_DEFAULTS = defaults.input as InputConfig;
/** What a sequencer plan may hold (Rust refuses anything else); read through `LIMITS.seq*`. */
export const SEQUENCER_LIMITS = defaults.sequencer;
