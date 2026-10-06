// Small helpers with no dependencies, shared across the app.

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A count with its noun: "1 widget", "3 widgets". */
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The message of anything thrown: IPC errors arrive as plain strings, not Errors. */
export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
