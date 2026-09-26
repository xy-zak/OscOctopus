// Pixel geometry for the knob: an arc rasterised onto a grid of square cells, so it shares the
// fader's shape language (segments + gaps, an exact cap line, quarter ticks) bent into a curve,
// with the stepped edges of pixel art. Pure: tested in ring.test.ts.
//
// Angles are degrees clockwise from 12 o'clock. A 270° ring opens at the bottom (-135…135);
// a 360° ring (endless encoder) starts at 12 o'clock.

/** Cell size in CSS px (the "pixel" of the pixel art). */
export const CELL = 2;
/** Segment and gap along the arc, in px at the ring's mid radius. Same as the fader. */
const SEG = 5;
const GAP = 2;
/** Room around the ring for the ticks. */
const MARGIN = 8;

interface Cell {
  x: number;
  y: number;
  /** Distance from the centre. */
  r: number;
  /** Radians clockwise from 12 o'clock, -π…π. */
  a: number;
}

export interface Ring {
  sweep: 270 | 360;
  nSeg: number;
  /** One SVG path per segment, in order along the arc. */
  segPaths: string[];
  /** Quarter ticks outside a 270° ring (empty for 360°). */
  tickPath: string;
  /** Every cell of the ring band, gaps included (for the cap). */
  cells: Cell[];
}

const deg = (d: number) => (d * Math.PI) / 180;

/** Position 0…1 along the ring → angle in radians. */
export function ringAngle(sweep: 270 | 360, t: number): number {
  return sweep === 270 ? deg(-135 + 270 * t) : deg(360 * t);
}

/** Cells → one path, merging horizontal runs so the path stays small. */
function toPath(cells: { x: number; y: number }[]): string {
  const rows = new Map<number, number[]>();
  for (const c of cells) {
    const row = rows.get(c.y);
    if (row) row.push(c.x);
    else rows.set(c.y, [c.x]);
  }
  let d = '';
  for (const [y, xs] of rows) {
    xs.sort((a, b) => a - b);
    let start = xs[0]!;
    let prev = start;
    for (let i = 1; i <= xs.length; i++) {
      const x = xs[i];
      if (x === prev + CELL) {
        prev = x;
        continue;
      }
      const len = prev + CELL - start;
      d += `M${start} ${y}h${len}v${CELL}h${-len}z`;
      if (x !== undefined) start = prev = x;
    }
  }
  return d;
}

export function buildRing(w: number, h: number, sweep: 270 | 360): Ring | null {
  // A 270° ring is 1 + cos 45° radii tall; centre it on its own extent, not its circle.
  const tall = sweep === 270 ? 1 + Math.SQRT1_2 : 2;
  const R = Math.floor(Math.min((w - 2 * MARGIN) / 2, (h - 2 * MARGIN) / tall));
  if (R < 8) return null;
  const thick = Math.max(6, Math.min(40, Math.round(R * 0.34)));
  const rIn = R - thick;
  const snap = (v: number) => Math.round(v / CELL) * CELL;
  const cx = snap(w / 2);
  const cy = snap(sweep === 270 ? h / 2 + (R * (2 - tall)) / 2 : h / 2);

  const span = deg(sweep);
  const arcMid = ((R + rIn) / 2) * span;
  const nSeg = Math.max(8, Math.round(arcMid / (SEG + GAP)));
  const lit = SEG / (SEG + GAP);
  const segCells: { x: number; y: number }[][] = Array.from({ length: nSeg }, () => []);
  const tickCells: { x: number; y: number }[] = [];
  const cells: Cell[] = [];
  const ticks =
    sweep === 270
      ? [0.25, 0.5, 0.75].map((t) => ({ a: ringAngle(270, t), len: t === 0.5 ? 6 : 4 }))
      : [];

  const x0 = cx - snap(R + MARGIN);
  const y0 = cy - snap(R + MARGIN);
  for (let y = y0; y < cy + R + MARGIN; y += CELL) {
    for (let x = x0; x < cx + R + MARGIN; x += CELL) {
      const dx = x + CELL / 2 - cx;
      const dy = y + CELL / 2 - cy;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dx, -dy);
      if (r > R + 2 && r <= R + 2 + 6) {
        for (const t of ticks) {
          if (r <= R + 2 + t.len && Math.abs(a - t.a) * r <= CELL / 2 + 0.01)
            tickCells.push({ x, y });
        }
        continue;
      }
      if (r < rIn || r > R) continue;
      // Position along the ring, 0…1.
      const t = sweep === 270 ? (a - deg(-135)) / span : (a < 0 ? a + 2 * Math.PI : a) / span;
      if (t < 0 || t > 1) continue;
      cells.push({ x, y, r, a });
      const u = t * nSeg;
      const i = Math.min(nSeg - 1, Math.floor(u));
      if (u - i <= lit) segCells[i]!.push({ x, y });
    }
  }
  return { sweep, nSeg, segPaths: segCells.map(toPath), tickPath: toPath(tickCells), cells };
}

/**
 * The exact-position cap at `t` (0…1): a radial bar across the band, plus a one-cell outline in
 * the background colour so it reads on lit and unlit segments alike (like the fader's cap).
 */
export function capPaths(ring: Ring, t: number): { cap: string; outline: string } {
  const at = ringAngle(ring.sweep, t);
  const cap: { x: number; y: number }[] = [];
  const outline: { x: number; y: number }[] = [];
  for (const c of ring.cells) {
    let da = Math.abs(c.a - at);
    if (da > Math.PI) da = 2 * Math.PI - da;
    const px = da * c.r;
    if (px <= 1.6) cap.push(c);
    else if (px <= 1.6 + CELL) outline.push(c);
  }
  return { cap: toPath(cap), outline: toPath(outline) };
}
