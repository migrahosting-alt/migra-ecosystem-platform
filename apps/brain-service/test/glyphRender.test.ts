/**
 * Letters drawn exactly.
 *
 * WHY. "generate letter A in png" through diffusion produced a clean capital A
 * at one seed and four glyphs reading "a a I I" at another — two lowercase a's
 * and two I's, for a request naming one uppercase letter. Prompt wording cannot
 * fix a sampler that is not drawing type. A font contains the exact outline, so
 * this path fills it: correct every time, not most times.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';

import { renderTextGlyph, resolveFontPath } from '../src/engine/media/glyphRender.js';
import { describeImageRequest } from '../src/engine/media/imagePrompt.js';

const decode = (png: Buffer) => PNG.sync.read(png);
/** Mean ink coverage of a region, 0 (blank) to 1 (solid). */
function ink(image: ReturnType<typeof decode>, x0: number, y0: number, x1: number, y1: number): number {
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * image.width + x) * 4;
      // Dark = ink, on the white background this renders by default.
      sum += 1 - image.data[i]! / 255;
      n += 1;
    }
  }
  return n === 0 ? 0 : sum / n;
}

test('a typeface is available to draw with', () => {
  assert.ok(resolveFontPath(), 'no usable font found — glyph rendering cannot work');
});

test('the regression fixture routes AWAY from diffusion', () => {
  const asked = describeImageRequest('generate letter A in png');
  assert.equal(asked.kind, 'glyph');
  if (asked.kind === 'glyph') {
    assert.equal(asked.text, 'A');
    assert.equal(asked.lowercase, false);
  }
});

test('a real scene still goes to the image model', () => {
  // The deterministic path is for single characters ONLY. Sending a lighthouse
  // through a typeface renderer would be absurd, and the reverse is the bug.
  const asked = describeImageRequest('generate an image of a lighthouse at night');
  assert.equal(asked.kind, 'scene');
});

test('it draws exactly one capital A, centred, on a clean background', () => {
  const out = renderTextGlyph('A', { size: 256, background: 'white' });
  const image = decode(out.png);
  assert.equal(image.width, 256);
  assert.equal(image.height, 256);

  // Ink in the middle, nothing in the corners: one centred glyph, no duplicates
  // tiled across the canvas — which is exactly what diffusion produced.
  assert.ok(ink(image, 96, 96, 160, 160) > 0.2, 'the glyph occupies the centre');
  for (const [x, y] of [[0, 0], [224, 0], [0, 224], [224, 224]] as const) {
    assert.ok(ink(image, x, y, x + 32, y + 32) < 0.02, `corner ${x},${y} is clean`);
  }
});

test("the letter's counter is a hole, not filled in", () => {
  /*
   * The triangular gap inside an 'A' is a contour wound the opposite way. Filling
   * it is the classic nonzero/even-odd mistake, and it produces a glyph that is
   * *almost* right — the same failure mode as a diffusion near-miss.
   */
  const image = decode(renderTextGlyph('A', { size: 512, background: 'white' }).png);
  /*
   * Asserted STRUCTURALLY rather than at fixed coordinates: somewhere there must
   * be a row whose centre is blank while ink sits on BOTH sides of it. That is
   * what an enclosed counter is, and it holds for any typeface or size — a first
   * version of this test probed a hardcoded y and hit the solid apex instead.
   */
  const half = Math.floor(image.width / 2);
  let enclosedRows = 0;
  for (let y = 0; y < image.height; y += 1) {
    const centre = ink(image, half - 10, y, half + 10, y + 1);
    if (centre > 0.1) continue;
    const left = ink(image, 0, y, half - 10, y + 1);
    const right = ink(image, half + 10, y, image.width, y + 1);
    if (left > 0.05 && right > 0.05) enclosedRows += 1;
  }
  assert.ok(enclosedRows > 10, `expected an open counter, found ${enclosedRows} enclosed rows`);
});

test('case is honoured rather than flattened', () => {
  const upper = decode(renderTextGlyph('A', { size: 128 }).png);
  const lower = decode(renderTextGlyph('a', { size: 128 }).png);
  // A lowercase 'a' is a different shape; identical output would mean the case
  // request was ignored.
  let differing = 0;
  for (let i = 0; i < upper.data.length; i += 4) {
    if (Math.abs(upper.data[i]! - lower.data[i]!) > 40) differing += 1;
  }
  assert.ok(differing > 500, `expected different glyphs, ${differing} pixels differed`);
});

test('a transparent background carries real alpha', () => {
  const image = decode(renderTextGlyph('A', { size: 128, background: 'transparent' }).png);
  const cornerAlpha = image.data[3]!;
  assert.equal(cornerAlpha, 0, 'the corner is fully transparent');
  let opaque = 0;
  for (let i = 3; i < image.data.length; i += 4) if (image.data[i]! > 200) opaque += 1;
  assert.ok(opaque > 200, 'and the glyph itself is opaque');
});

test('the same request draws the same bytes every time', () => {
  // Determinism is the entire point: a seeded sampler is not reproducible, a
  // filled outline is.
  const a = renderTextGlyph('7', { size: 128 }).png;
  const b = renderTextGlyph('7', { size: 128 }).png;
  assert.ok(a.equals(b));
});

test('digits and punctuation work, not just letters', () => {
  for (const ch of ['7', 'Z', '?', '#']) {
    const image = decode(renderTextGlyph(ch, { size: 128 }).png);
    assert.ok(ink(image, 32, 32, 96, 96) > 0.05, `${ch} drew something`);
  }
});
