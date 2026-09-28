import { describe, expect, it } from 'vitest';
import { fill, parseMarkup, placeholdersOf, type Run } from './markup';

const plain = (text: string, over: Partial<Run> = {}): Run => ({
  text,
  strong: false,
  reverse: false,
  tone: null,
  ...over,
});

describe('text markup', () => {
  it('turns each line into a block: headings, list items, gaps and lines', () => {
    expect(parseMarkup('# Stage\n- one\n\nplain').map((b) => b.kind)).toEqual([
      'heading',
      'item',
      'gap',
      'line',
    ]);
    expect(parseMarkup('# Stage')[0]!.runs).toEqual([plain('Stage')]);
  });

  it('marks bold, reverse and palette colour, nested', () => {
    expect(parseMarkup('a **b ==c== d** {3:e **f**} g')[0]!.runs).toEqual([
      plain('a '),
      plain('b ', { strong: true }),
      plain('c', { strong: true, reverse: true }),
      plain(' d', { strong: true }),
      plain(' '),
      plain('e ', { tone: 3 }),
      plain('f', { tone: 3, strong: true }),
      plain(' g'),
    ]);
  });

  it('ends a mark left open with its line', () => {
    const [a, b] = parseMarkup('**open\nnext');
    expect(a!.runs).toEqual([plain('open', { strong: true })]);
    expect(b!.runs).toEqual([plain('next')]);
  });

  it('keeps escaped marks, stray braces and unknown tags as text', () => {
    expect(parseMarkup('\\*\\*not bold\\*\\* {x y} } {12:z}')[0]!.runs).toEqual([
      plain('**not bold** {x y} } {12:z}'),
    ]);
  });

  it('fills placeholders, also inside a colour, without parsing the value', () => {
    const blocks = parseMarkup('Level: {3:{value}} of {max} ({x})');
    expect(placeholdersOf(blocks)).toEqual(['value', 'max', 'x']);
    const filled = fill(blocks, (name) =>
      name === 'value' ? '**0.5**' : name === 'x' ? '1' : undefined,
    );
    expect(filled[0]!.runs).toEqual([
      plain('Level: '),
      plain('**0.5**', { tone: 3 }),
      plain(' of '),
      plain('{max}'),
      plain(' ('),
      plain('1'),
      plain(')'),
    ]);
  });

  it('stays linear on hostile input', () => {
    const hostile = '{'.repeat(50_000) + '*'.repeat(50_000) + '='.repeat(50_001);
    const started = performance.now();
    const [block] = parseMarkup(hostile);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(block!.runs.map((r) => r.text).join('')).toBe('{'.repeat(50_000) + '=');
  });
});
