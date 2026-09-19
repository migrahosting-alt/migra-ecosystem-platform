/**
 * 🚨 THE DEFECT. `hat` was requested unconditionally, and on a host whose
 * tesseract has only eng/fra/osd the whole job died:
 *
 *   Error opening data file /usr/share/tesseract-ocr/5/tessdata/hat.traineddata
 *
 * A 245-page Haitian Creole book rendered all 245 pages and then recovered
 * nothing, over one missing data file. Rendering is the expensive half and had
 * already been paid for.
 *
 * 🚨 THE LANGUAGE SET IS INJECTED. The first version of this file asked the HOST
 * what it had, so on a machine with no tesseract every case hit an early return
 * and asserted nothing — four green tests covering nothing at all.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { chooseOcrLanguage } from '../src/engine/rag/scannedOcr.js';

const STAGING = new Set(['eng', 'fra', 'osd']);   // what the host actually had
const COMPLETE = new Set(['eng', 'fra', 'hat', 'osd']);

test('the preferred language wins when it is installed', async () => {
  const choice = await chooseOcrLanguage('hat', COMPLETE);
  assert.equal(choice?.language, 'hat');
  assert.equal(choice?.degradedFrom, undefined, 'using what was asked for is not a degradation');
});

test('Creole falls back to French, and says so', async () => {
  // Measured on the real book: hat preserves more Haitian diacritics than fra
  // (35 v 22, 14 v 10), so fra is a real second best rather than a guess.
  const choice = await chooseOcrLanguage('hat', STAGING);
  assert.equal(choice?.language, 'fra');
  assert.equal(choice?.degradedFrom, 'hat', 'a substitution must be reported, never silent');
});

test('English is the last resort, not the second choice', async () => {
  const choice = await chooseOcrLanguage('hat', new Set(['eng', 'osd']));
  assert.equal(choice?.language, 'eng');
  assert.equal(choice?.degradedFrom, 'hat');
});

test('nothing usable is null — a different fact from a missing recogniser', async () => {
  assert.equal(await chooseOcrLanguage('hat', new Set(['osd'])), null);
});

test('an unasked-for language still gets something installed', async () => {
  // Rendering already succeeded, so recovering SOME text beats recovering none.
  const choice = await chooseOcrLanguage('zzz', STAGING);
  assert.equal(choice?.language, 'eng');
  assert.equal(choice?.degradedFrom, 'zzz');
});

test('an unanswerable host is not a refusal', async () => {
  // An empty set means the question could not be asked. Refusing on the
  // strength of an answer we never got would fail a host that is fine.
  const choice = await chooseOcrLanguage('hat', new Set());
  assert.equal(choice?.language, 'hat');
});
