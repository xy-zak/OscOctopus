// A user skin (schema.ts) as CSS, in the `skin.user` layer and keyed on its frames
// (`.frame[data-skin='<id>']`), so it overrides its base skin wherever it says something and
// nowhere else. Pure; tested in compile.test.ts.
//
// Every selector is built from anatomy names and every value from numbers and enums (and
// base64 checked by the schema), so nothing a skin file says can escape into the CSS.
//
// A part's `rest` style applies while it shows no other look: a fader cap styled at rest still
// turns the base skin's ACTIVE colour while dragged, unless the skin styles `dragging` too.
import { PARTS, type PartName, type State, type StateScope } from './anatomy';
import type { ImageUse, Paint, PartStyles, Role, Skin, StateKey, Style } from './schema';

/** States that are a layout, not a look: a rest style holds in either. */
const LAYOUTS = new Set<State>(['vertical', 'horizontal', 'live']);
/** Parts too small to hold an image layer: an image replaces their own background. */
const LEAVES = new Set<PartName>(['switch.grip', 'slider.grip']);

/**
 * The order rules are written in, so where two states apply at once the later one wins:
 * layouts first, then the looks from quiet to insistent.
 */
export const ORDER: readonly StateKey[] = [
  'rest',
  'vertical',
  'horizontal',
  'live',
  'in',
  'out',
  'strong',
  'tinted',
  'reverse',
  'on',
  'current',
  'running',
  'paused',
  'active',
  'lit',
  'armed',
  'holding',
  'flash',
  'fading',
  'blocked',
  'error',
  'held',
  'down',
  'pressed',
  'dragging',
  'lifted',
];

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

export function paintCss(p: Paint): string {
  const c = 'role' in p ? roleCss(p.role) : p.hex;
  return p.alpha >= 1 ? c : `color-mix(in srgb, ${c} ${pct(p.alpha)}, transparent)`;
}

const roleCss = (r: Role) => (r === 'shadow' ? 'var(--shadow-px)' : `var(--${r})`);

function fillCss(f: NonNullable<Style['fill']>): string {
  const c = paintCss(f.paint);
  const hatch = (deg: number) =>
    `repeating-linear-gradient(${deg}deg, ${c} 0 1.5px, transparent 1.5px 6px)`;
  switch (f.texture) {
    case 'solid':
      return c;
    case 'dither50':
      return `repeating-conic-gradient(${c} 0 25%, transparent 0 50%) 0 0 / 4px 4px`;
    case 'dither25':
      return `conic-gradient(at 2px 2px, transparent 75%, ${c} 0) 0 0 / 4px 4px`;
    case 'hatch':
      return hatch(-45);
    case 'crosshatch':
      return `${hatch(-45)}, ${hatch(45)}`;
    case 'dots':
      return `radial-gradient(${c} 1.2px, transparent 1.6px) 0 0 / 6px 6px`;
  }
}

function shadowCss(s: NonNullable<Style['shadows']>[number]): string {
  const c = paintCss(s.paint);
  if (s.kind === 'glow') return `0 0 ${s.blur}px ${c}`;
  return `${s.kind === 'inset' ? 'inset ' : ''}${s.x}px ${s.y}px ${s.blur}px ${c}`;
}

/** The part's own declarations (everything but its image). */
function styleDecls(style: Style): string[] {
  const d: string[] = [];
  if (style.fill !== undefined) d.push(`background: ${style.fill ? fillCss(style.fill) : 'none'}`);
  if (style.line !== undefined) {
    d.push(
      style.line
        ? `border: ${style.line.width}px ${style.line.style} ${paintCss(style.line.paint)}`
        : 'border: 0',
    );
  }
  if (style.radius !== undefined) d.push(`border-radius: ${style.radius}px`);
  if (style.shadows !== undefined) {
    d.push(
      `box-shadow: ${style.shadows.length ? style.shadows.map(shadowCss).join(', ') : 'none'}`,
    );
  }
  if (style.text !== undefined) d.push(`color: ${paintCss(style.text)}`);
  if (style.opacity !== undefined) d.push(`opacity: ${style.opacity}`);
  return d;
}

/** How an image is laid over a box: as its background (plain) or as a mask (tinted). */
function imageDecls(img: ImageUse, leaf: boolean): string[] {
  const src = `var(--skin-img-${img.ref})`;
  const [t, r, b, l] = img.slice;
  const place: Record<Exclude<ImageUse['mode'], 'nine'>, string> = {
    stretch: 'center / 100% 100% no-repeat',
    cover: 'center / cover no-repeat',
    contain: 'center / contain no-repeat',
    tile: '0 0 repeat',
  };
  // A layer of its own, cleared of whatever the base skin drew on the same pseudo-element.
  const d = leaf
    ? []
    : [
        "content: ''",
        'position: absolute',
        'inset: 0',
        'pointer-events: none',
        'border: 0',
        'border-image: none',
        'border-radius: inherit',
        // Its own size and place, whatever the base skin gave this pseudo-element.
        'width: auto',
        'height: auto',
        'aspect-ratio: auto',
        'translate: none',
        'scale: none',
        'rotate: none',
        'box-shadow: none',
        'background: none',
        '-webkit-mask: none',
        'mask: none',
        '-webkit-mask-box-image: none',
      ];
  if (leaf) d.push('color: transparent');
  if (img.tint) {
    d.push(`background: ${roleCss(img.tint)}`);
    if (img.mode === 'nine') {
      d.push(
        `-webkit-mask-box-image: ${src} ${t} ${r} ${b} ${l} / ${t}px ${r}px ${b}px ${l}px stretch`,
      );
    } else {
      d.push(`-webkit-mask: ${src} ${place[img.mode]}`, `mask: ${src} ${place[img.mode]}`);
    }
  } else if (img.mode === 'nine') {
    d.push(
      'border-style: solid',
      'border-color: transparent',
      `border-width: ${t}px ${r}px ${b}px ${l}px`,
      `border-image: ${src} ${t} ${r} ${b} ${l} fill / ${t}px ${r}px ${b}px ${l}px stretch`,
    );
  } else {
    d.push(`background: ${src} ${place[img.mode]}`);
  }
  return d;
}

/** The selector for a part in a state (`prefix` scopes it, e.g. to light mode). */
export function selectorFor(id: string, part: PartName, state: StateKey, prefix = ''): string {
  const frame = `.frame[data-skin='${id}']`;
  const states = PARTS[part].states as Partial<Record<State, StateScope>>;
  const looks = (Object.entries(states) as [State, StateScope][]).filter(
    ([s]) => !LAYOUTS.has(s) && s !== 'lifted',
  );
  const not = (scope: StateScope) =>
    looks
      .filter(([, sc]) => sc === scope)
      .map(([s]) => `:not([data-${s}])`)
      .join('');
  const self = `[data-part='${part}']`;

  if (part === 'frame') {
    if (state === 'rest') return `${prefix}${frame}${not('frame')}`;
    if (state === 'lifted') return `${prefix}[data-lifted] ${frame}`;
    return `${prefix}${frame}[data-${state}]`;
  }
  // A key's own states sit on the key; inside a key, on the enclosing one.
  const onKey = part === 'keycap';
  if (state === 'rest') {
    const key = !onKey && not('key') ? `[data-part='keycap']${not('key')} ` : '';
    const own = not('self') + (onKey ? not('key') : '');
    return `${prefix}${frame}${not('frame')} ${key}${self}${own}`;
  }
  const scope = states[state];
  if (scope === 'frame') return `${prefix}${frame}[data-${state}] ${self}`;
  if (scope === 'key' && !onKey)
    return `${prefix}${frame} [data-part='keycap'][data-${state}] ${self}`;
  return `${prefix}${frame} ${self}[data-${state}]`;
}

function partRules(id: string, parts: PartStyles, prefix: string): string[] {
  const out: string[] = [];
  const rule = (sel: string, decls: string[]) => {
    if (decls.length) out.push(`${sel} {\n  ${decls.join(';\n  ')};\n}`);
  };
  for (const state of ORDER) {
    for (const [part, states] of Object.entries(parts) as [PartName, Record<string, Style>][]) {
      const style = states[state];
      if (!style) continue;
      const sel = selectorFor(id, part, state, prefix);
      rule(sel, styleDecls(style));
      if (style.image === undefined) continue;
      const leaf = LEAVES.has(part);
      if (style.image === null) {
        // The skin clears the base skin's image layers on this part.
        if (!leaf)
          rule(`${sel}::before, ${sel}::after`, [
            'background: none',
            '-webkit-mask: none',
            'mask: none',
            '-webkit-mask-box-image: none',
          ]);
      } else {
        const layer = style.image.layer === 'over' ? '::after' : '::before';
        rule(leaf ? sel : `${sel}${layer}`, imageDecls(style.image, leaf));
      }
    }
  }
  return out;
}

export function compileSkin(skin: Skin): string {
  const frame = `.frame[data-skin='${skin.id}']`;
  const vars: string[] = [];
  for (const [token, px] of Object.entries(skin.tokens)) vars.push(`${token}: ${px}px`);
  if (skin.scale) vars.push(`--slider-tick-c: ${paintCss(skin.scale)}`);
  for (const [ref, img] of Object.entries(skin.images)) {
    vars.push(`--skin-img-${ref}: url("data:${img.mime};base64,${img.data}")`);
  }
  const rules = [
    ...(vars.length ? [`${frame} {\n  ${vars.join(';\n  ')};\n}`] : []),
    ...partRules(skin.id, skin.parts, ''),
    ...partRules(skin.id, skin.light, ":root[data-mode='light'] "),
  ];
  return `@layer skin.user {\n${rules.join('\n')}\n}\n`;
}
