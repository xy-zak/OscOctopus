// The text widget's markup: a few marks that keep to the app's look (weight, reverse video,
// palette colour; size is the widget's own setting), parsed into plain runs that are rendered
// as text, never as HTML. Pure; tested in markup.test.ts.
//
//   # Heading      a heading line (bold capitals)
//   - item         a list item
//   **bold**       bold
//   ==reverse==    reverse video
//   {3:text}       palette colour 3 (0-9)
//   {value}        a placeholder, filled from the widget's value (see `fill`)
//   \*             a mark character as itself
//
// Every other line is a line of its own; an empty one is a gap. A mark left open ends with its
// line. The scanner is linear: it never backtracks, whatever the text.

export type BlockKind = 'line' | 'heading' | 'item' | 'gap';

export interface Run {
  /** Text as written, or (before `fill`) the name of a placeholder. */
  text: string;
  placeholder?: true;
  strong: boolean;
  reverse: boolean;
  /** Palette index, or null for the text's own colour. */
  tone: number | null;
}

export interface Block {
  kind: BlockKind;
  runs: Run[];
}

const TONE = /\{([0-9]):/y;
const PLACEHOLDER = /\{([A-Za-z0-9_]{1,32})\}/y;

function parseLine(line: string): Run[] {
  const runs: Run[] = [];
  let text = '';
  let strong = false;
  let reverse = false;
  let tone: number | null = null;
  const flush = () => {
    if (text) runs.push({ text, strong, reverse, tone });
    text = '';
  };
  let i = 0;
  while (i < line.length) {
    const c = line[i]!;
    if (c === '\\' && i + 1 < line.length) {
      text += line[i + 1];
      i += 2;
      continue;
    }
    if ((c === '*' || c === '=') && line[i + 1] === c) {
      flush();
      if (c === '*') strong = !strong;
      else reverse = !reverse;
      i += 2;
      continue;
    }
    if (c === '{') {
      TONE.lastIndex = i;
      const t = TONE.exec(line);
      if (t) {
        flush();
        tone = Number(t[1]);
        i = TONE.lastIndex;
        continue;
      }
      PLACEHOLDER.lastIndex = i;
      const p = PLACEHOLDER.exec(line);
      if (p) {
        flush();
        runs.push({ text: p[1]!, placeholder: true, strong, reverse, tone });
        i = PLACEHOLDER.lastIndex;
        continue;
      }
    }
    if (c === '}' && tone !== null) {
      flush();
      tone = null;
      i++;
      continue;
    }
    text += c;
    i++;
  }
  flush();
  return runs;
}

export function parseMarkup(source: string): Block[] {
  return source.split(/\r?\n/).map((line): Block => {
    if (line.trim() === '') return { kind: 'gap', runs: [] };
    if (line.startsWith('# ')) return { kind: 'heading', runs: parseLine(line.slice(2)) };
    if (line.startsWith('- ')) return { kind: 'item', runs: parseLine(line.slice(2)) };
    return { kind: 'line', runs: parseLine(line) };
  });
}

/** The placeholders a text uses, e.g. `value`, `x`. */
export function placeholdersOf(blocks: readonly Block[]): string[] {
  const names = new Set<string>();
  for (const b of blocks) for (const r of b.runs) if (r.placeholder) names.add(r.text);
  return [...names];
}

/**
 * The blocks with every placeholder replaced by `value(name)`, or left as `{name}` when that
 * gives undefined. The filled text is never parsed again, so a received value can't add marks.
 */
export function fill(
  blocks: readonly Block[],
  value: (name: string) => string | undefined,
): Block[] {
  return blocks.map((b) => ({
    kind: b.kind,
    runs: b.runs.map((r) =>
      r.placeholder ? { ...r, placeholder: undefined, text: value(r.text) ?? `{${r.text}}` } : r,
    ),
  }));
}
