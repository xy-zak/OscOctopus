// Small helpers with no dependencies, shared across the app.

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The message of anything thrown: IPC errors arrive as plain strings, not Errors. */
export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
