// Migra Models v1 — the selector must offer PRODUCT identities, not backends.
//
// Structural, because this is a promise about what a user sees and it would
// regress silently: someone adds a "handy" model list back and nothing fails
// until a screenshot shows qwen2.5-coder:14b in a product dropdown.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MIGRA_FAMILY_IDS, MIGRA_MODEL_FAMILIES } from '@migrapilot/shared-types/model-families';

const CHAT_VIEW = join(__dirname, '..', '..', '..', 'src', 'panel', 'chatView.ts');
const source = readFileSync(CHAT_VIEW, 'utf8');

/** The block that renders the user-facing selector. */
function familyBranch(): string {
  const start = source.indexOf("case 'families': {");
  assert.ok(start > 0, 'the family selector branch must exist');
  return source.slice(start, source.indexOf("case 'models': {", start));
}

test('the selector renders families, and the catalog has all six', () => {
  assert.equal(MIGRA_FAMILY_IDS.length, 6);
  const branch = familyBranch();
  assert.match(branch, /f\.displayName/, 'it must render the product name');
  assert.match(branch, /f\.tagline/, 'it must render the outcome, not the model');
});

test('NO backend model name is hard-coded anywhere in the view', () => {
  // Names that have leaked into UIs before, plus the vendor prefixes.
  const forbidden = [/qwen[0-9.]*[-:]/i, /deepseek-r1/i, /llama3/i, /minicpm/i, /llava/i, /gpt-oss/i];
  const offenders = forbidden.filter((re) => re.test(source)).map((re) => re.source);
  assert.deepEqual(offenders, [], 'a backend model name is hard-coded in the chat view');
});

test('an unavailable family is DISABLED and explains itself, never silently dropped', () => {
  const branch = familyBranch();
  assert.match(branch, /disabled/, 'unavailable families must render disabled');
  assert.match(branch, /unavailableReason/, 'the reason must reach the user');
});

test('the selector cannot leave a disabled family selected', () => {
  assert.match(familyBranch(), /!o\.disabled/, 'a disabled option must not survive as the selection');
});

test('every family in the catalog carries a user-facing tagline in outcomes', () => {
  for (const id of MIGRA_FAMILY_IDS) {
    const f = MIGRA_MODEL_FAMILIES[id];
    assert.ok(f.tagline.length > 10, `${id} needs a real tagline`);
    // The tagline is what a user reads; infrastructure must not appear in it.
    assert.doesNotMatch(f.tagline, /qwen|llama|ollama|gpu|runpod|model id/i, `${id} tagline leaks infrastructure`);
    assert.doesNotMatch(f.description, /qwen|llama|ollama|runpod/i, `${id} description leaks infrastructure`);
  }
});

test('exactly one family is the recommended default', () => {
  const rec = MIGRA_FAMILY_IDS.filter((id) => MIGRA_MODEL_FAMILIES[id].recommended);
  assert.deepEqual(rec, ['migra-core']);
});

test('the catalog declares NO status — readiness is resolved, not written down', () => {
  // A hand-written PROVEN_LIVE/PARTIAL per family used to live here AND gate
  // availability, so a literal decided what the product could do. Status now
  // comes from governance and evidence; the catalog only declares identity and
  // requirements.
  const serialised = JSON.stringify(MIGRA_MODEL_FAMILIES);
  for (const word of ['PROVEN_LIVE', 'PARTIAL', 'BLOCKED', 'INTENT', 'auditedStatus']) {
    assert.equal(serialised.includes(word), false, `the catalog still encodes "${word}"`);
  }
});

test('every family declares a governance basis rather than a status', () => {
  for (const id of MIGRA_FAMILY_IDS) {
    const req = MIGRA_MODEL_FAMILIES[id].requirements;
    const governed = Boolean(req.governedCapability) || Boolean(req.taskClasses?.length);
    assert.equal(governed, true, `${id} rests on no governance basis`);
  }
});
