// Received OSC → widget values: the inverse of mapping.ts. Pure; tested in input.test.ts.
//
// A binding that receives listens for its address, either literally or as a template whose
// `{channel}` placeholders capture that channel's value from the address (the inverse of
// `fillAddress`). Its argument templates are applied in reverse:
//   - a value template sets its channel from the argument in its position;
//   - a const template is a filter: the argument must equal it, or the message doesn't match.
// The resulting patch goes to the widget type's `input()` (widgets/<type>/def.ts), which
// turns it into a value.
import type { OscArg } from '../ipc/types';
import type { ArgTemplate, Binding, Widget } from '../model/preset';
import { defaultChannel, messagesOf } from '../widgets/defs';
import type { InputPatch } from '../widgets/types';
import { buildMessages } from './mapping';
import type { Scalar, ValueList, WidgetValue } from './value';

// ---- addresses --------------------------------------------------------------------------

export type Compiled =
  | { kind: 'literal'; address: string }
  | { kind: 'template'; regex: RegExp; names: string[] }
  | { kind: 'invalid'; error: string };

const invalid = (error: string): Compiled => ({ kind: 'invalid', error });
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A receive address: literal, or a template whose `{name}` placeholders each capture one or
 * more characters within a segment. Wildcards and `{a,b}` alternatives can be sent but not
 * received, and two placeholders need something between them (else the split is ambiguous).
 */
export function compileAddress(address: string): Compiled {
  if (!address.startsWith('/')) return invalid("must start with '/'");
  for (const c of address) {
    const code = c.codePointAt(0)!;
    if (code < 0x21 || code > 0x7e) return invalid('only printable ASCII without spaces');
  }
  if (/[*?[\]#,]/.test(address)) return invalid('wildcards (* ? [ ]), # and , are send-only');
  const names: string[] = [];
  let source = '^';
  let last = 0;
  for (const m of address.matchAll(/\{([^{}]*)\}/g)) {
    const name = m[1]!;
    if (!/^[A-Za-z0-9_]+$/.test(name)) return invalid(`{${name}} is not a channel name`);
    if (names.includes(name)) return invalid(`{${name}} appears twice`);
    if (m.index === last && names.length) return invalid('put something between two placeholders');
    source += `${escapeRe(address.slice(last, m.index))}([^/]+?)`;
    names.push(name);
    last = m.index + m[0].length;
  }
  if (/[{}]/.test(address.replace(/\{[A-Za-z0-9_]+\}/g, ''))) return invalid('unmatched { or }');
  if (names.length === 0) return { kind: 'literal', address };
  return {
    kind: 'template',
    regex: new RegExp(`${source}${escapeRe(address.slice(last))}$`),
    names,
  };
}

/** Channel values captured by a matching address, or null if it doesn't match. */
export function matchAddress(c: Compiled, address: string): Record<string, string> | null {
  if (c.kind === 'literal') return c.address === address ? {} : null;
  if (c.kind === 'invalid') return null;
  const m = c.regex.exec(address);
  return m ? Object.fromEntries(c.names.map((name, i) => [name, m[i + 1]!])) : null;
}

/** Whether an incoming address is an OSC pattern (it may address several methods). */
export const isPattern = (address: string) => /[*?[\]{}]/.test(address);

const patterns = new Map<string, RegExp | null>();

/**
 * An incoming OSC 1.0 address pattern (`*` `?` `[a-z]` `[!0-9]` `{foo,bar}`) as a RegExp over
 * whole addresses; nothing in it ever matches `/`. Null if malformed. Cached.
 */
export function oscPattern(pattern: string): RegExp | null {
  const cached = patterns.get(pattern);
  if (cached !== undefined) return cached;
  let re: RegExp | null = null;
  try {
    let source = '^';
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i]!;
      if (c === '*') source += '[^/]*';
      else if (c === '?') source += '[^/]';
      else if (c === '[') {
        const end = pattern.indexOf(']', i + 1);
        if (end < 0) throw new Error('unclosed [');
        let body = pattern.slice(i + 1, end);
        const negate = body.startsWith('!');
        if (negate) body = body.slice(1);
        const cls = body.replace(/[\\\]^]/g, '\\$&').replace(/\//g, '');
        source += negate ? `[^/${cls}]` : `[${cls}]`;
        i = end;
      } else if (c === '{') {
        const end = pattern.indexOf('}', i + 1);
        if (end < 0) throw new Error('unclosed {');
        source += `(?:${pattern
          .slice(i + 1, end)
          .split(',')
          .map(escapeRe)
          .join('|')})`;
        i = end;
      } else source += escapeRe(c);
    }
    re = new RegExp(`${source}$`);
  } catch {
    re = null;
  }
  if (patterns.size >= 256) patterns.clear();
  patterns.set(pattern, re);
  return re;
}

// ---- arguments --------------------------------------------------------------------------

/** An argument's plain value, or undefined for types that carry none a widget can use. */
function natural(a: OscArg): Scalar | ValueList | undefined {
  switch (a.type) {
    case 'i':
    case 'f':
    case 'h':
    case 'd':
    case 'r':
    case 's':
    case 'c':
      return a.value;
    case 'T':
      return true;
    case 'F':
      return false;
    case '[':
      return a.value.map(natural).filter((v): v is Scalar => v !== undefined && !Array.isArray(v));
    default:
      return undefined;
  }
}

const numberOf = (a: OscArg): number | undefined => {
  const v = natural(a);
  return typeof v === 'number' ? v : typeof v === 'boolean' ? Number(v) : undefined;
};

/** Whether a received argument equals a const template (numbers compared as the template's type). */
function constMatches(t: Extract<ArgTemplate, { kind: 'const' }>, a: OscArg): boolean {
  switch (t.type) {
    case 'f':
      return Math.fround(numberOf(a) ?? NaN) === Math.fround(Number(t.value));
    case 'i':
    case 'h':
      return numberOf(a) === Math.round(Number(t.value));
    case 'd':
      return Math.abs((numberOf(a) ?? NaN) - Number(t.value)) < 1e-9;
    case 's':
      return (a.type === 's' || a.type === 'c') && a.value === t.value;
    default:
      return a.type === t.type;
  }
}

/** What a value template takes from its argument. */
function templateValue(type: string, a: OscArg): Scalar | ValueList | undefined {
  const v = natural(a);
  if (v === undefined) return undefined;
  if (type === '[]' || type === 'auto') return v;
  const one = Array.isArray(v) ? v[0] : v;
  return type === 's' && one !== undefined ? String(one) : one;
}

/**
 * What a message says about a widget's channels, through a binding's templates in reverse;
 * null if it doesn't match (a const filter fails or is missing). Address captures come first;
 * arguments override them. Missing trailing value arguments are left out; extra ones ignored.
 */
export function decodePatch(
  widget: Widget,
  binding: Binding,
  args: readonly OscArg[],
  captures: Record<string, string>,
): InputPatch | null {
  const patch: InputPatch = { ...captures };
  const fallback = defaultChannel(widget);
  let i = 0;
  for (const t of binding.args) {
    if (t.kind === 'const') {
      const a = args[i++];
      if (!a || !constMatches(t, a)) return null;
      continue;
    }
    const channel = t.channel ?? fallback;
    if (t.type === '...') {
      patch[channel] = args.slice(i).flatMap((a) => {
        const v = natural(a);
        return v === undefined ? [] : Array.isArray(v) ? v : [v];
      });
      break;
    }
    const a = args[i++];
    const v = a === undefined ? undefined : templateValue(t.type, a);
    if (v !== undefined) patch[channel] = v;
  }
  return patch;
}

// ---- what a binding may do --------------------------------------------------------------

/** Why this binding can't receive, or null if it can (shown in the editor). */
export function receiveProblem(widget: Widget, binding: Binding): string | null {
  if (messagesOf(widget) === 'none') return 'this widget has no messages';
  const c = compileAddress(binding.address);
  if (c.kind === 'invalid') return c.error;
  if (binding.args.some((a) => a.kind === 'value' && a.type === 'm')) {
    return 'MIDI (m) arguments can only be sent, not received';
  }
  const p = widget.props as { onValue?: number; offValue?: number };
  if (p.onValue !== undefined && p.onValue === p.offValue) {
    return 'on and off values are the same, so a received value can’t pick one';
  }
  if (binding.sourceIds.length === 0) return 'choose where to listen';
  return null;
}

/** Why received input must never be forwarded through this widget's messages, or null. */
export function forwardProblem(widget: Widget): string | null {
  if (messagesOf(widget) !== 'full') return 'this widget only shows what it receives';
  if (widget.type === 'button' && widget.props.arm !== 'none') {
    return 'an armed button only fires from a deliberate local press';
  }
  return null;
}

const f32 = (a: OscArg): unknown =>
  a.type === 'f' ? Math.fround(a.value) : a.type === '[' ? a.value.map(f32) : a;

/**
 * What a value would put on the wire, as a comparable string (float32 as sent). Forwarding
 * only happens when this changes, so a value that only differs in precision isn't re-sent.
 */
export function wireFingerprint(widget: Widget, value: WidgetValue): string {
  return JSON.stringify(
    buildMessages(widget, value).map((m) => [m.message.address, m.message.args.map(f32)]),
  );
}
