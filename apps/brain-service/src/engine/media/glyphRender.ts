import { readFileSync, existsSync } from 'node:fs';
import { PNG } from 'pngjs';
import opentype from 'opentype.js';

/**
 * Letters, digits and symbols, drawn EXACTLY.
 *
 * WHY THIS EXISTS. "generate letter A in png" is not an artistic request, and a
 * diffusion model cannot be made to spell reliably. The same shaped prompt at
 * one seed produced a clean capital A and at another produced four glyphs
 * reading "a a I I" — two lowercase a's and two I's, for a request naming one
 * uppercase letter. No amount of prompt wording fixes a sampler that is not
 * drawing type; it is generating something that looks like type.
 *
 * A single character is a SOLVED problem: a font already contains the exact
 * outline, and filling it is arithmetic. So a request for a bare glyph is drawn
 * from a real typeface instead of hallucinated, which makes it correct every
 * time rather than most times — and instant rather than seconds of GPU.
 *
 * PURE JAVASCRIPT, deliberately. `sharp`, `canvas` and `resvg` are all native,
 * and the production VM cannot load native prebuilt binaries at all (its CPU
 * predates x86-64-v2). opentype.js parses the outline, the scanline fill below
 * turns it into coverage, and pngjs writes the file — the same code on a
 * workstation and on that VM.
 */

/** Where the typeface comes from. Overridable so a deployment can choose one. */
export const FONT_CANDIDATES: readonly string[] = [
  process.env.MIGRAPILOT_GLYPH_FONT ?? '',
  '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf',
].filter(Boolean);

export function resolveFontPath(candidates: readonly string[] = FONT_CANDIDATES): string | null {
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  return null;
}

let cachedFont: { path: string; font: opentype.Font } | null = null;

function loadFont(path: string): opentype.Font {
  if (cachedFont?.path === path) return cachedFont.font;
  const font = opentype.parse(readFileSync(path).buffer as ArrayBuffer);
  cachedFont = { path, font };
  return font;
}

export interface GlyphOptions {
  /** Output edge, in pixels. Square. */
  size?: number;
  /** Fraction of the canvas left empty around the glyph. */
  margin?: number;
  /** Transparent lets the artefact drop onto any background; white matches paper. */
  background?: 'white' | 'transparent';
  /** Ink colour, as [r, g, b]. */
  color?: [number, number, number];
  fontPath?: string;
}

export interface RenderedGlyph {
  png: Buffer;
  width: number;
  height: number;
  /** The typeface actually used, so provenance can name it rather than guess. */
  fontPath: string;
}

/** One point on a flattened outline. */
interface Point {
  x: number;
  y: number;
}

/**
 * Curves become line segments.
 *
 * Sixteen steps is far more than needed at these sizes: the error of a flattened
 * cubic is well under a supersample cell, so the rasteriser cannot see the
 * difference and the cost is trivial.
 */
const CURVE_STEPS = 16;

function flatten(commands: readonly opentype.PathCommand[]): Point[][] {
  const contours: Point[][] = [];
  let current: Point[] = [];
  let cursor: Point = { x: 0, y: 0 };

  const push = (p: Point) => current.push(p);

  for (const cmd of commands) {
    if (cmd.type === 'M') {
      if (current.length > 1) contours.push(current);
      current = [];
      cursor = { x: cmd.x, y: cmd.y };
      push(cursor);
    } else if (cmd.type === 'L') {
      cursor = { x: cmd.x, y: cmd.y };
      push(cursor);
    } else if (cmd.type === 'Q') {
      const from = cursor;
      for (let i = 1; i <= CURVE_STEPS; i += 1) {
        const t = i / CURVE_STEPS;
        const u = 1 - t;
        push({
          x: u * u * from.x + 2 * u * t * cmd.x1 + t * t * cmd.x,
          y: u * u * from.y + 2 * u * t * cmd.y1 + t * t * cmd.y,
        });
      }
      cursor = { x: cmd.x, y: cmd.y };
    } else if (cmd.type === 'C') {
      const from = cursor;
      for (let i = 1; i <= CURVE_STEPS; i += 1) {
        const t = i / CURVE_STEPS;
        const u = 1 - t;
        push({
          x: u * u * u * from.x + 3 * u * u * t * cmd.x1 + 3 * u * t * t * cmd.x2 + t * t * t * cmd.x,
          y: u * u * u * from.y + 3 * u * u * t * cmd.y1 + 3 * u * t * t * cmd.y2 + t * t * t * cmd.y,
        });
      }
      cursor = { x: cmd.x, y: cmd.y };
    } else if (cmd.type === 'Z') {
      if (current.length > 1) contours.push(current);
      current = [];
    }
  }
  if (current.length > 1) contours.push(current);
  return contours;
}

/**
 * Scanline fill with NONZERO winding, supersampled.
 *
 * Nonzero rather than even-odd because that is what type outlines assume: the
 * counter of an 'A' is a contour wound the OPPOSITE way, and even-odd would
 * happen to agree here while disagreeing on glyphs with overlapping contours.
 * Getting this wrong fills the hole in a letter, which is exactly the kind of
 * "almost right" a diffusion model already produces.
 */
function coverage(contours: Point[][], width: number, height: number, samples: number): Float32Array {
  const acc = new Float32Array(width * height);
  const edges: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (const contour of contours) {
    for (let i = 0; i < contour.length; i += 1) {
      const a = contour[i]!;
      const b = contour[(i + 1) % contour.length]!;
      if (a.y !== b.y) edges.push({ x0: a.x, y0: a.y, x1: b.x, y1: b.y });
    }
  }
  if (edges.length === 0) return acc;

  const crossings: { x: number; dir: number }[] = [];
  for (let sy = 0; sy < height * samples; sy += 1) {
    const y = (sy + 0.5) / samples;
    crossings.length = 0;
    for (const e of edges) {
      const [top, bottom] = e.y0 < e.y1 ? [e.y0, e.y1] : [e.y1, e.y0];
      if (y < top || y >= bottom) continue;
      const t = (y - e.y0) / (e.y1 - e.y0);
      crossings.push({ x: e.x0 + t * (e.x1 - e.x0), dir: e.y1 > e.y0 ? 1 : -1 });
    }
    if (crossings.length === 0) continue;
    crossings.sort((a, b) => a.x - b.x);

    let winding = 0;
    const row = Math.floor(sy / samples) * width;
    for (let i = 0; i < crossings.length - 1; i += 1) {
      winding += crossings[i]!.dir;
      if (winding === 0) continue;
      // Span [x, next) is inside. Accumulate per output pixel with partial ends.
      const from = crossings[i]!.x;
      const to = crossings[i + 1]!.x;
      const first = Math.max(0, Math.floor(from));
      const last = Math.min(width - 1, Math.ceil(to) - 1);
      for (let px = first; px <= last; px += 1) {
        const left = Math.max(from, px);
        const right = Math.min(to, px + 1);
        if (right > left) acc[row + px] = (acc[row + px] ?? 0) + (right - left) / samples;
      }
    }
  }
  return acc;
}

/**
 * Draw the requested characters, exactly once, centred.
 *
 * The glyph is measured and then scaled to the canvas, so a wide 'W' and a
 * narrow 'I' both fill the frame the same way rather than one arriving tiny.
 */
export function renderTextGlyph(text: string, options: GlyphOptions = {}): RenderedGlyph {
  const size = options.size ?? 1024;
  const margin = options.margin ?? 0.12;
  const background = options.background ?? 'white';
  const [r, g, b] = options.color ?? [17, 17, 17];

  const fontPath = options.fontPath ?? resolveFontPath();
  if (!fontPath) {
    throw new Error('No usable typeface was found for glyph rendering.');
  }
  const font = loadFont(fontPath);

  // Measure at a reference size, then fit. `getPath` returns screen coordinates
  // with y increasing downward and the baseline at the given y.
  const reference = 1000;
  const measured = font.getPath(text, 0, 0, reference);
  const box = measured.getBoundingBox();
  const glyphWidth = box.x2 - box.x1;
  const glyphHeight = box.y2 - box.y1;
  if (!(glyphWidth > 0) || !(glyphHeight > 0)) {
    throw new Error(`The typeface has no drawable outline for ${JSON.stringify(text)}.`);
  }

  const usable = size * (1 - margin * 2);
  const scale = Math.min(usable / glyphWidth, usable / glyphHeight);
  const drawSize = reference * scale;
  // Centre the INK box, not the advance width: a glyph's side bearings are not
  // symmetric, and centring the advance leaves it visibly off to one side.
  const scaled = font.getPath(text, 0, 0, drawSize);
  const sb = scaled.getBoundingBox();
  const offsetX = (size - (sb.x2 - sb.x1)) / 2 - sb.x1;
  const offsetY = (size - (sb.y2 - sb.y1)) / 2 - sb.y1;
  const placed = font.getPath(text, offsetX, offsetY, drawSize);

  const alpha = coverage(flatten(placed.commands), size, size, 4);

  const png = new PNG({ width: size, height: size });
  for (let i = 0; i < size * size; i += 1) {
    const a = Math.max(0, Math.min(1, alpha[i] ?? 0));
    const o = i * 4;
    if (background === 'transparent') {
      png.data[o] = r;
      png.data[o + 1] = g;
      png.data[o + 2] = b;
      png.data[o + 3] = Math.round(a * 255);
    } else {
      // Composited onto white, so the file has no alpha surprises when reused.
      png.data[o] = Math.round(255 + (r - 255) * a);
      png.data[o + 1] = Math.round(255 + (g - 255) * a);
      png.data[o + 2] = Math.round(255 + (b - 255) * a);
      png.data[o + 3] = 255;
    }
  }

  return { png: PNG.sync.write(png), width: size, height: size, fontPath };
}
