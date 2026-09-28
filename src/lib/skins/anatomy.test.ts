// Holds the widget components to the anatomy rules (see anatomy.ts): they lay out, skins paint.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MARKER_PARTS, PARTS, TOKENS, type StateScope } from './anatomy';
import { BUILTIN_SKIN_IDS } from './builtin';

const components = import.meta.glob('../widgets/**/*.svelte', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
// Read from disk: Vitest hands CSS imports over empty, `?raw` included.
const here = new URL('.', import.meta.url);
const skins: Record<string, string> = Object.fromEntries(
  readdirSync(here)
    .filter((f) => f.endsWith('.css'))
    .map((f) => [`./${f}`, readFileSync(new URL(f, here), 'utf8')]),
);

/** Properties that are look, not structure: only skins may set them. */
const PAINT =
  /^(-webkit-)?(background(-[\w-]+)?|color|border(-[\w-]+)?|outline(-[\w-]+)?|box-shadow|text-shadow|filter|backdrop-filter|mask(-[\w-]+)?|opacity|animation(-[\w-]+)?|transition(-[\w-]+)?|font|font-(weight|style|family)|text-transform|letter-spacing|fill|stroke(-[\w-]+)?)$/;

const styleOf = (src: string) =>
  [...src.matchAll(/<style>([\s\S]*?)<\/style>/g)]
    .map((m) => m[1]!)
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');

/** Every `property` declared in a stylesheet (innermost `{…}` blocks). */
function declarations(css: string): string[] {
  const props: string[] = [];
  for (const block of css.matchAll(/\{([^{}]*)\}/g)) {
    for (const decl of block[1]!.split(';')) {
      const m = /^\s*(-?-?[a-zA-Z][\w-]*)\s*:/.exec(decl);
      if (m) props.push(m[1]!);
    }
  }
  return props;
}

const partsIn = (src: string, quote: string) =>
  [...src.matchAll(new RegExp(`data-part=${quote}([^${quote}]+)${quote}`, 'g'))].map((m) => m[1]!);

describe('widget anatomy', () => {
  // The widgets themselves; their Inspectors and editor fields are app chrome, not skinned.
  const files = Object.entries(components).filter(
    ([file]) => !/Inspector\.svelte$/.test(file) && !file.includes('/fields/'),
  );

  it('finds the widget components', () => {
    expect(files.map(([f]) => f.split('/').pop()).sort()).toEqual([
      'Button.svelte',
      'Graph.svelte',
      'Keycap.svelte',
      'List.svelte',
      'Log.svelte',
      'Pads.svelte',
      'Sequencer.svelte',
      'Slider.svelte',
      'Switch.svelte',
      'Text.svelte',
      'WidgetFrame.svelte',
    ]);
  });

  it('components only lay out: every colour, border, shadow and animation is a skin’s', () => {
    for (const [file, src] of files) {
      const css = styleOf(src);
      const paint = declarations(css).filter((p) => PAINT.test(p));
      expect(paint, file).toEqual([]);
      expect(css, `${file}: keyframes belong in a skin`).not.toMatch(/@keyframes/);
    }
  });

  it('components read the skin tokens but never set them', () => {
    const tokens = new Set(Object.keys(TOKENS));
    for (const [file, src] of files) {
      const set = declarations(styleOf(src)).filter((p) => tokens.has(p));
      expect(set, file).toEqual([]);
    }
  });

  it('marks only parts the anatomy knows, and every part is used', () => {
    const known = new Set(Object.keys(PARTS));
    const used = new Set<string>();
    for (const [file, src] of files) {
      for (const part of partsIn(src, '"')) {
        expect(known.has(part), `${file}: unknown part "${part}"`).toBe(true);
        used.add(part);
      }
    }
    const unused = [...known].filter((p) => !used.has(p));
    expect(unused).toEqual([]);
  });

  // A state the anatomy says a part shows on itself (scope `self`, or the key's own `down`)
  // must be an attribute of that part's element, or skins keyed on it never match.
  it('puts each state a part shows on itself on the part’s own element', () => {
    /** The opening tag of every element marked as `part` (braces skipped, they hold `>`). */
    const tags = (part: string) =>
      files.flatMap(([file, src]) =>
        [...src.matchAll(new RegExp(`data-part="${part.replace('.', '\\.')}"`, 'g'))].map((m) => {
          let end = m.index;
          for (let depth = 0; end < src.length; end++) {
            if (src[end] === '{') depth++;
            else if (src[end] === '}') depth--;
            else if (src[end] === '>' && depth === 0) break;
          }
          return [file, src.slice(src.lastIndexOf('<', m.index), end)] as const;
        }),
      );
    for (const [part, { states }] of Object.entries(PARTS)) {
      const own = Object.entries(states as Record<string, StateScope>)
        .filter(([, scope]) => scope === 'self' || (part === 'keycap' && scope === 'key'))
        .map(([state]) => state);
      for (const [file, tag] of tags(part)) {
        for (const state of own) {
          expect(tag, `${file}: ${part} lacks data-${state}`).toMatch(
            new RegExp(`\\sdata-${state}=`),
          );
        }
      }
    }
  });

  it('skin stylesheets style only known parts', () => {
    const known = new Set(Object.keys(PARTS));
    for (const [file, css] of Object.entries(skins)) {
      for (const part of partsIn(css, "'")) {
        expect(known.has(part), `${file}: unknown part "${part}"`).toBe(true);
      }
    }
  });
});

// What every skin keeps the same (docs/SKINS.md): base.css sets it once, the skins may not.
describe('skin contract', () => {
  const skinFiles = Object.entries(skins).filter(([file]) => !file.endsWith('/base.css'));

  /** Every rule of a stylesheet: its selectors and declarations (keyframe steps skipped). */
  function rules(css: string) {
    const out: { selectors: string[]; decls: [string, string][] }[] = [];
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of clean.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
      const selectors = m[1]!
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (selectors.every((s) => /^(from|to|[\d.]+%)$/.test(s))) continue;
      const decls = m[2]!
        .split(';')
        .map((d) => /^\s*(-?-?[a-zA-Z][\w-]*)\s*:\s*([\s\S]*)$/.exec(d))
        .filter((d): d is RegExpExecArray => d !== null)
        .map((d) => [d[1]!, d[2]!.trim()] as [string, string]);
      out.push({ selectors, decls });
    }
    return out;
  }

  /** Text the same in every skin: one font, one size, the same weights and case. */
  const TYPE =
    /^(font(-[\w-]+)?|text-transform|letter-spacing|word-spacing|line-height|writing-mode|text-align)$/;
  /** Shown in the same place in every skin: a skin colours these, never hides or moves them. */
  const MARKERS: ReadonlySet<string> = MARKER_PARTS;
  const MOVES =
    /^(visibility|display|content|position|inset|top|right|bottom|left|translate|transform|rotate|scale|width|height|margin(-\w+)?|padding(-\w+)?|clip-path)$/;
  /** The part a selector styles: its last `[data-part]`, if nothing but attributes follow. */
  const subject = (sel: string) => /\[data-part='([\w.]+)'\](\[[^\]]*\])*$/.exec(sel)?.[1];

  it('has one stylesheet per registered skin, and no other', () => {
    const files = skinFiles.map(([f]) => f.split('/').pop()!.replace('.css', '')).sort();
    expect(files).toEqual([...BUILTIN_SKIN_IDS].sort());
  });

  it('keeps the typography: no font or text properties in any skin', () => {
    for (const [file, css] of skinFiles) {
      const typed = rules(css).flatMap((r) => r.decls.filter(([p]) => TYPE.test(p)));
      expect(typed, file).toEqual([]);
      expect(css, `${file}: fonts are the app's`).not.toMatch(/@font-face/);
    }
  });

  it('keeps the markers: a skin never hides, moves or resizes them', () => {
    for (const [file, css] of skinFiles) {
      for (const { selectors, decls } of rules(css)) {
        const marker = selectors.map(subject).find((p) => p && MARKERS.has(p));
        if (!marker) continue;
        const bad = decls.filter(([p, v]) => MOVES.test(p) || (p === 'opacity' && Number(v) === 0));
        expect(bad, `${file}: ${marker}`).toEqual([]);
        if (marker === 'slider.ticks') {
          // base.css draws the scale; a skin only colours it (--slider-tick-c).
          expect(
            decls.map(([p]) => p),
            `${file}: slider.ticks`,
          ).not.toContain('background');
        }
      }
    }
  });

  it('keeps the desk: every rule is keyed on its own skin’s widget frames', () => {
    for (const [file, css] of skinFiles) {
      const id = file.split('/').pop()!.replace('.css', '');
      for (const { selectors } of rules(css)) {
        for (const sel of selectors) {
          expect(sel, file).toContain(`.frame[data-base='${id}']`);
        }
      }
    }
  });
});
