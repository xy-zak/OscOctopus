// The small constructors every other factory builds on: ids, bindings and argument templates.
import type { ArgTemplate, Binding, ValueArgType } from './preset';

/** Short random id, valid for IdSchema. */
export function uid(prefix = ''): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const s = Array.from(bytes, (b) => b.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 10);
  return prefix ? `${prefix}-${s}` : s;
}

/** A value argument: (a channel of) the widget's value as `type`. */
export function valueArg(type: ValueArgType, channel?: string): ArgTemplate {
  return channel ? { kind: 'value', type, channel } : { kind: 'value', type };
}

export function newBinding(
  address: string,
  outputIds: string[],
  args: ArgTemplate[] = [valueArg('f')],
): Binding {
  return { id: uid('b'), enabled: true, outputIds, address, args };
}
