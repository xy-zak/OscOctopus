import { describe, expect, it } from 'vitest';
import { MARKER_PARTS, PARTS, type PartName } from './anatomy';
import { compileSkin, ORDER, selectorFor } from './compile';
import {
  LENGTH_TOKENS,
  ROLES,
  SKIN_FORMAT,
  SkinSchema,
  STATE_KEYS,
  TEXTURES,
  type Skin,
} from './schema';

const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function skin(patch: Partial<Record<string, unknown>> = {}): Skin {
  return SkinSchema.parse({
    format: SKIN_FORMAT,
    version: 1,
    id: 'skin-test',
    name: 'Test',
    base: 'glass',
    ...patch,
  });
}

describe('selectors', () => {
  const id = 'skin-a';
  it('puts each state where the anatomy says it sits', () => {
    expect(selectorFor(id, 'frame', 'active')).toBe(".frame[data-skin='skin-a'][data-active]");
    expect(selectorFor(id, 'frame', 'lifted')).toBe("[data-lifted] .frame[data-skin='skin-a']");
    expect(selectorFor(id, 'switch.thumb', 'on')).toBe(
      ".frame[data-skin='skin-a'][data-on] [data-part='switch.thumb']",
    );
    expect(selectorFor(id, 'pads.pad', 'on')).toBe(
      ".frame[data-skin='skin-a'] [data-part='pads.pad'][data-on]",
    );
    expect(selectorFor(id, 'keycap.face', 'down')).toBe(
      ".frame[data-skin='skin-a'] [data-part='keycap'][data-down] [data-part='keycap.face']",
    );
    expect(selectorFor(id, 'keycap', 'down')).toBe(
      ".frame[data-skin='skin-a'] [data-part='keycap'][data-down]",
    );
  });

  it('makes rest mean "showing no other look"; layouts don’t count', () => {
    expect(selectorFor(id, 'frame', 'rest')).toBe(
      ".frame[data-skin='skin-a']:not([data-active]):not([data-pressed])",
    );
    expect(selectorFor(id, 'switch.thumb', 'rest')).toBe(
      ".frame[data-skin='skin-a']:not([data-on]):not([data-dragging]) [data-part='switch.thumb']",
    );
    expect(selectorFor(id, 'keycap.face', 'rest')).toBe(
      ".frame[data-skin='skin-a'] [data-part='keycap']:not([data-down]) [data-part='keycap.face']",
    );
    expect(selectorFor(id, 'list.option', 'rest')).toBe(
      ".frame[data-skin='skin-a'] [data-part='list.option']:not([data-current]):not([data-held])",
    );
  });

  it('writes every state in a fixed order', () => {
    expect([...ORDER].sort()).toEqual([...STATE_KEYS].sort());
  });
});

describe('compileSkin', () => {
  it('writes tokens, the scale colour, images and part styles into the user layer', () => {
    const css = compileSkin(
      skin({
        tokens: { '--slider-cap-len': 18 },
        scale: { role: 'fg', alpha: 0.4 },
        images: { 'img-knob': { mime: 'image/png', data: PNG_1PX, w: 1, h: 1 } },
        parts: {
          'switch.thumb': {
            rest: { fill: { paint: { hex: '#ff0000' } }, radius: 4 },
            on: { shadows: [{ kind: 'glow', blur: 12, paint: { role: 'act' } }] },
          },
          'slider.cap': {
            rest: { image: { ref: 'img-knob', mode: 'contain', tint: 'c' } },
          },
        },
        light: { frame: { rest: { line: null } } },
      }),
    );
    expect(css.startsWith('@layer skin.user {')).toBe(true);
    expect(css).toContain('--slider-cap-len: 18px');
    expect(css).toContain('--slider-tick-c: color-mix(in srgb, var(--fg) 40%, transparent)');
    expect(css).toContain(`--skin-img-img-knob: url("data:image/png;base64,${PNG_1PX}")`);
    expect(css).toContain('background: #ff0000');
    expect(css).toContain('border-radius: 4px');
    expect(css).toContain('box-shadow: 0 0 12px var(--act)');
    expect(css).toContain("[data-part='slider.cap']::before {\n  content: ''");
    expect(css).toContain('mask: var(--skin-img-img-knob) center / contain no-repeat');
    // The layer is the image's alone: the base skin's size and offsets for it are cleared.
    expect(css).toMatch(
      /slider\.cap'\]::before \{[^}]*inset: 0;[^}]*width: auto;[^}]*translate: none/,
    );
    expect(css).toContain(":root[data-mode='light'] .frame[data-skin='skin-test']");
  });

  it('says nothing about what every skin keeps: no typography, nothing hidden', () => {
    const css = compileSkin(fuzzSkin(1));
    expect(css).not.toMatch(/font|text-transform|letter-spacing|visibility|display:/);
  });
});

describe('SkinSchema', () => {
  const bad = (patch: Record<string, unknown>) =>
    SkinSchema.safeParse({
      format: SKIN_FORMAT,
      version: 1,
      id: 'skin-x',
      name: 'X',
      base: 'terminal',
      ...patch,
    }).success;

  it('accepts a minimal skin and fills in the defaults', () => {
    expect(skin()).toMatchObject({ tokens: {}, parts: {}, light: {}, images: {} });
  });
  it('refuses a state the part doesn’t have, and unknown fields anywhere', () => {
    expect(bad({ parts: { 'switch.thumb': { held: { radius: 2 } } } })).toBe(false);
    expect(bad({ parts: { 'switch.thumb': { rest: { radius: 2, fontWeight: 700 } } } })).toBe(
      false,
    );
    expect(bad({ parts: { 'no.such': { rest: {} } } })).toBe(false);
    expect(bad({ fonts: ['Comic Sans'] })).toBe(false);
  });
  it('keeps the markers: no image or fade on them', () => {
    expect(bad({ parts: { 'slider.ticks': { rest: { opacity: 0.5 } } } })).toBe(false);
    expect(bad({ parts: { 'pads.num': { rest: { text: { role: 'act' } } } } })).toBe(true);
  });
  it('checks images: known, the right kind for the part, not too large', () => {
    const images = { 'img-a': { mime: 'image/png', data: PNG_1PX, w: 1, h: 1 } };
    const use = (part: string, mode: string, ref = 'img-a') => ({
      images,
      parts: { [part]: { rest: { image: { ref, mode } } } },
    });
    expect(bad(use('keycap.face', 'nine'))).toBe(true);
    expect(bad(use('keycap.face', 'nine', 'img-b'))).toBe(false);
    expect(bad(use('graph.cursor', 'contain'))).toBe(true);
    expect(bad(use('graph.cursor', 'nine'))).toBe(false);
    const big = 'A'.repeat(800 * 1024);
    expect(bad({ images: { 'img-a': { mime: 'image/png', data: big, w: 1, h: 1 } } })).toBe(false);
    expect(bad({ images: { 'img-a': { mime: 'text/html', data: PNG_1PX, w: 1, h: 1 } } })).toBe(
      false,
    );
  });
  it('refuses ids and colours that could escape into CSS', () => {
    expect(bad({ id: "skin-a'] body { x" })).toBe(false);
    expect(bad({ parts: { frame: { rest: { text: { hex: 'red;}' } } } } })).toBe(false);
  });
});

// ---- fuzz: random valid skins never write anything but the CSS they are meant to ----

function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

function fuzzSkin(seed: number): Skin {
  const r = rng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const paint = () =>
    r() < 0.5
      ? { role: pick(ROLES), alpha: Math.round(r() * 100) / 100 }
      : {
          hex: `#${Math.floor(r() * 0xffffff)
            .toString(16)
            .padStart(6, '0')}`,
          alpha: 1,
        };
  const images = { 'img-a': { mime: 'image/png' as const, data: PNG_1PX, w: 1, h: 1 } };
  const parts: Record<string, Record<string, unknown>> = {};
  for (const part of Object.keys(PARTS) as PartName[]) {
    if (r() < 0.5) continue;
    const states = ['rest', ...Object.keys(PARTS[part].states)];
    const state = pick(states);
    const kind = PARTS[part].image as string;
    const marker = MARKER_PARTS.has(part);
    const mode =
      kind === 'region'
        ? pick(['nine', 'stretch', 'cover', 'contain', 'tile'])
        : kind === 'glyph'
          ? 'contain'
          : 'tile';
    parts[part] = {
      [state]: {
        fill: r() < 0.2 ? null : { paint: paint(), texture: pick(TEXTURES) },
        line:
          r() < 0.2
            ? null
            : {
                width: Math.floor(r() * 9),
                style: pick(['solid', 'dashed', 'dotted']),
                paint: paint(),
              },
        radius: Math.floor(r() * 65),
        shadows: [
          {
            kind: pick(['drop', 'glow', 'inset']),
            x: Math.floor(r() * 33) - 16,
            y: 2,
            blur: Math.floor(r() * 33),
            paint: paint(),
          },
        ],
        text: paint(),
        ...(marker ? {} : { opacity: 0.1 + Math.round(r() * 90) / 100 }),
        ...(!marker && kind !== 'none' && r() < 0.5
          ? {
              image: {
                ref: 'img-a',
                mode,
                slice: [4, 4, 4, 4],
                tint: r() < 0.5 ? pick(ROLES) : null,
                layer: pick(['under', 'over']),
              },
            }
          : {}),
      },
    };
  }
  const tokens = Object.fromEntries(
    LENGTH_TOKENS.filter(() => r() < 0.3).map((t) => [t, Math.floor(r() * 65)]),
  );
  return skin({
    id: `skin-f${seed}`,
    keycap: pick(['bevel', 'flat']),
    tokens,
    scale: paint(),
    images,
    parts,
    light: parts,
  });
}

describe('compileSkin fuzz', () => {
  it('turns 300 random valid skins into well-formed, contained CSS', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const css = compileSkin(fuzzSkin(seed));
      // Take out what is allowed to hold quotes: data URLs and the anatomy's attribute values.
      const bare = css
        .replace(
          /url\("data:image\/(png|webp|jpeg|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}"\)/g,
          'URL',
        )
        .replace(/\[data-(part|skin)='[\w.-]+'\]/g, '[X]')
        .replace(/:root\[data-mode='light'\]/g, ':root[X]')
        .replace(/content: ''/g, 'content: none');
      expect(bare, `seed ${seed}`).not.toMatch(/["'<\\]|@import|javascript:|expression\(/);
      expect((css.match(/\{/g) ?? []).length, `seed ${seed}`).toBe((css.match(/\}/g) ?? []).length);
      // Every rule outside the frame-level variables is scoped to the skin's own frames.
      for (const block of css.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
        for (const sel of block[1]!.split(',').map((s) => s.trim())) {
          expect(sel, `seed ${seed}`).toContain(`.frame[data-skin='skin-f${seed}']`);
        }
      }
    }
  });
});
