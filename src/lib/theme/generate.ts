// Custom palette generator: one picked colour → ten colours, light to dark. Pure; tested in
// generate.test.ts.
//
// Worked in OKLCH, where equal steps in lightness look equal. The picked colour is kept exactly
// and becomes colour 5 (the default accent). The lighter colours above it drift towards yellow
// and the darker ones below towards violet, each by the shortest way round the colour wheel.
// That is the rule the built-in themed palettes follow (SUNSET: yellow → orange → pink →
// purple; COBALT: ice → cobalt → indigo), so neighbouring colours stay distinct, not just
// lighter or darker. A grey source gives a plain grey ramp.
import { DEFAULT_ACCENT, PALETTE_SIZE } from './palettes';

type Lab = { L: number; a: number; b: number };
type Lch = { L: number; C: number; h: number };

/** Lightness (OKLCH L: 0 black – 1 white) of the lightest colour. */
const TOP = 0.98;
/**
 * The darkest colour sits DARK_SPAN below the source, but at least as dark as BOTTOM (so a
 * light source still gets real darks) and never darker than FLOOR (it must show on black).
 */
const DARK_SPAN = 0.3;
const BOTTOM = 0.45;
const FLOOR = 0.32;
/** Smallest lightness step between neighbours, so no two colours look the same. */
const MIN_STEP = 0.02;
/** Where the hue drifts to: lighter colours towards yellow, darker towards violet. */
const WARM_HUE = 95;
const COOL_HUE = 290;
/** The most the hue drifts at the lightest and darkest ends, in degrees. */
const WARM_SHIFT = 45;
const COOL_SHIFT = 55;
/** Below this chroma a colour counts as grey: its hue means nothing. */
const GREY = 0.02;

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** A CSS hex colour as lowercase #rrggbb, or null if it isn't one (#rgb is expanded). */
export function normalizeHex(input: string): string | null {
  const m = HEX.exec(input.trim());
  if (!m) return null;
  const h = m[1]!.toLowerCase();
  return `#${h.length === 3 ? h.replace(/./g, '$&$&') : h}`;
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

function hexToLab(hex: string): Lab {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => toLinear(c / 255)) as [
    number,
    number,
    number,
  ];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/** Linear sRGB of an OKLab colour; components outside 0–1 are out of gamut. */
function labToLinear({ L, a, b }: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function hexToLch(hex: string): Lch {
  const { L, a, b } = hexToLab(hex);
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return { L, C: Math.hypot(a, b), h: h < 0 ? h + 360 : h };
}

const lchToLab = ({ L, C, h }: Lch): Lab => ({
  L,
  a: C * Math.cos((h * Math.PI) / 180),
  b: C * Math.sin((h * Math.PI) / 180),
});

const inGamut = (rgb: number[]) => rgb.every((c) => c >= -1e-4 && c <= 1 + 1e-4);

/** The colour as #rrggbb, lowering its chroma until it fits in sRGB (hue and lightness stay). */
export function lchToHex(lch: Lch): string {
  let rgb = labToLinear(lchToLab(lch));
  if (!inGamut(rgb)) {
    let lo = 0;
    let hi = lch.C;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(labToLinear(lchToLab({ ...lch, C: mid })))) lo = mid;
      else hi = mid;
    }
    rgb = labToLinear(lchToLab({ ...lch, C: lo }));
  }
  const byte = (c: number) => Math.round(Math.min(1, Math.max(0, toGamma(c))) * 255);
  return `#${rgb.map((c) => byte(c).toString(16).padStart(2, '0')).join('')}`;
}

/** Signed shortest turn from hue `from` to hue `to`, in degrees (-180…180). */
const turn = (from: number, to: number) => ((((to - from) % 360) + 540) % 360) - 180;

/** `h` moved towards `target` by at most `max` degrees, never past it. */
function drift(h: number, target: number, max: number): number {
  const d = turn(h, target);
  const moved = h + Math.sign(d) * Math.min(Math.abs(d), max);
  return ((moved % 360) + 360) % 360;
}

/**
 * Where the source goes in the ramp: colour 5 (the default accent) whenever there is room for
 * distinct lighter and darker colours around it. A near-white source moves towards colour 0 and
 * a near-black one towards colour 9, so the other nine still differ.
 */
function sourceIndex(L: number, top: number, bottom: number): number {
  const last = PALETTE_SIZE - 1;
  const above = Math.floor((top - L) / MIN_STEP + 1e-9);
  const below = Math.floor((L - bottom) / MIN_STEP + 1e-9);
  if (above < DEFAULT_ACCENT) return Math.max(0, above);
  if (below < last - DEFAULT_ACCENT) return Math.min(last, last - Math.max(0, below));
  return DEFAULT_ACCENT;
}

/** Ten colours from one: lightest first, the source itself included exactly. */
export function generatePalette(source: string): string[] {
  const hex = normalizeHex(source) ?? '#808080';
  const src = hexToLch(hex);
  const last = PALETTE_SIZE - 1;
  const top = Math.max(TOP, src.L);
  const bottom = Math.min(BOTTOM, Math.max(FLOOR, src.L - DARK_SPAN));
  const at = sourceIndex(src.L, top, bottom);
  const grey = src.C < GREY;

  return Array.from({ length: PALETTE_SIZE }, (_, i) => {
    if (i === at) return hex;
    if (i < at) {
      // 0 next to the source … 1 at the lightest.
      const t = (at - i) / at;
      return lchToHex({
        L: src.L + (top - src.L) * t,
        C: src.C * (1 - 0.25 * t),
        h: grey ? src.h : drift(src.h, WARM_HUE, WARM_SHIFT * t),
      });
    }
    const t = (i - at) / (last - at);
    return lchToHex({
      L: src.L - (src.L - bottom) * t,
      C: src.C * (1 - 0.1 * t),
      h: grey ? src.h : drift(src.h, COOL_HUE, COOL_SHIFT * t),
    });
  });
}

/**
 * The palette for a new source, keeping every colour that was picked by hand (`overridden`)
 * and regenerating the rest.
 */
export function regenerate(
  source: string,
  colors: readonly string[],
  overridden: readonly boolean[],
): string[] {
  const fresh = generatePalette(source);
  return fresh.map((c, i) => (overridden[i] ? (colors[i] ?? c) : c));
}
