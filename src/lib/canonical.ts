// Canonical JSON: exactly one text per meaning. Object keys are sorted, -0 is written as 0,
// non-finite numbers as null, and undefined object fields are left out. Two values compare
// equal exactly when they mean the same thing, which is what sync diffs and digests need
// (a re-normalised value must never look like an edit).

export function canonical(value: unknown): string {
  return JSON.stringify(normalize(value)) ?? 'null';
}

function normalize(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Object.is(v, -0) ? 0 : Number.isFinite(v) ? v : null;
  if (Array.isArray(v)) return v.map(normalize);
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(v).sort()) {
      const field = (v as Record<string, unknown>)[key];
      if (field !== undefined) out[key] = normalize(field);
    }
    return out;
  }
  return v;
}
