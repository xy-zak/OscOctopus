// Endpoint defaults, owned by Rust (`impl Default for OutputConfig / InputConfig`) and written
// next to the generated types by `npm run bindings`, so the two sides can't drift.
import defaults from './bindings/defaults.json';
import type { InputConfig, OutputConfig } from './types';

// JSON imports widen string literals; defaults.test.ts validates the file against the schemas.
export const OUTPUT_DEFAULTS = defaults.output as OutputConfig;
export const INPUT_DEFAULTS = defaults.input as InputConfig;
