// A block of text for a desk: static, the value of a received message, or another widget's
// live value, written in a small markup (markup.ts). It never sends: in `osc` mode its messages
// only receive (`messages: 'receive'`), otherwise it has none.
import { LIMITS, type TextWidget } from '../../model/preset';
import { newBinding, valueArg } from '../../model/parts';
import { isList, isRecord, type Scalar, type ValueList, type WidgetValue } from '../../osc/value';
import type { WidgetDef } from '../types';

const clip = (s: string) => s.slice(0, LIMITS.textChars.max);

/**
 * What a `{name}` placeholder shows of a value: `{value}` is the value (a record's `value`
 * channel, or the whole record), `{x}` a record's channel, `{0}` a list's item. Undefined when
 * the value has no such part, so the placeholder stays as written.
 */
export function placeholderValue(value: WidgetValue, name: string): WidgetValue | undefined {
  if (isRecord(value)) return name in value ? value[name] : name === 'value' ? value : undefined;
  if (isList(value) && /^\d+$/.test(name)) return value[Number(name)];
  return name === 'value' ? value : undefined;
}

/** A received argument as the text's value: a scalar, a list joined, text at most textChars. */
function asText(v: Scalar | ValueList): Scalar {
  if (isList(v)) return clip(v.map(String).join(' '));
  return typeof v === 'string' ? clip(v) : v;
}

export const textDef: WidgetDef<TextWidget> = {
  label: 'Text',
  defaultSize: { w: 3, h: 2 },
  create: (base, n) => ({
    ...base,
    type: 'text',
    label: `Text ${n}`,
    // For `osc` mode: turn IN on and choose where it listens. It never sends.
    bindings: [{ ...newBinding(`/octopus/text/${n}`, [], [valueArg('s')]), send: false }],
    props: {
      mode: 'text',
      source: 'Write **anything** here.',
      size: 'm',
      align: 'left',
      valign: 'top',
      target: null,
      decimals: 2,
    },
  }),
  initialValue: () => '',
  channels: () => [],
  gate: () => ({ kind: 'queue' }),
  input: (_w, patch) => (patch.value === undefined ? null : asText(patch.value)),
  echoTolerance: () => ({ value: 0 }),
  isValue: (_w, v): v is Scalar =>
    typeof v === 'number' ||
    typeof v === 'boolean' ||
    (typeof v === 'string' && v.length <= LIMITS.textChars.max),
  messages: (w) => (w.props.mode === 'osc' ? 'receive' : 'none'),
  remapRefs: (w, ids) => {
    if (w.props.target !== null) w.props.target = ids.get(w.props.target) ?? null;
  },
};
