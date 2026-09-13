/**
 * An approval is for bytes, not for a name.
 *
 * The gap these pin: the decision row has always stored `model_digest`, and the
 * approve route has always refused evidence without one — and nothing ever
 * compared it to the installed model. So the precise failure the approve
 * route's own comment warns about ("a tag can be repointed at different weights
 * afterwards") was live.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  checkApprovalIntegrity, INTEGRITY_REASON_TEXT, type IntegrityFailure,
} from '../src/engine/models/approvalIntegrity.js';

const A = 'sha256:' + 'a'.repeat(64);
const B = 'sha256:' + 'b'.repeat(64);
const installed = (map: Record<string, string>) => (id: string) =>
  Object.prototype.hasOwnProperty.call(map, id) ? map[id] : undefined;

test('matching weights pass', () => {
  const v = checkApprovalIntegrity({ modelId: 'm', modelDigest: A }, installed({ m: A }));
  assert.equal(v.ok, true);
  if (v.ok) assert.equal(v.digest, A);
});

test('🚨 a repointed tag is REFUSED, not silently honoured', () => {
  const v = checkApprovalIntegrity({ modelId: 'm', modelDigest: A }, installed({ m: B }));
  assert.equal(v.ok, false);
  if (!v.ok) {
    assert.equal(v.reason, 'digest_mismatch');
    // Both digests named, so an operator can see WHICH changed…
    assert.match(v.detail, /approved sha256:aaaaaaaaaaaaaaaa…/);
    assert.match(v.detail, /installed sha256:bbbbbbbbbbbbbbbb…/);
    // …and neither printed in full, which would invite eyeballing a 64-char
    // string as if that were verification.
    assert.doesNotMatch(v.detail, new RegExp('a'.repeat(64)));
  }
});

test('🚨 formatting is not tampering — bare hex equals sha256-prefixed', () => {
  // Ollama reports bare hex on /api/tags; the approval stores `sha256:` + hex.
  // Comparing them raw would report a mismatch for IDENTICAL weights, which is
  // a fail-closed refusal for a formatting difference — the fastest way to make
  // people stop trusting the check.
  const bare = 'a'.repeat(64);
  const v = checkApprovalIntegrity({ modelId: 'm', modelDigest: A }, installed({ m: bare }));
  assert.equal(v.ok, true);
  const upper = checkApprovalIntegrity({ modelId: 'm', modelDigest: A }, installed({ m: bare.toUpperCase() }));
  assert.equal(upper.ok, true);
});

/* ── the three refusals that are NOT tampering, and are refusals anyway ──── */

test('a model that is not installed is refused', () => {
  const v = checkApprovalIntegrity({ modelId: 'gone', modelDigest: A }, installed({ other: A }));
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, 'model_absent');
});

test('🚨 an approval naming NO digest cannot be relied on', () => {
  // A legacy row. It is not evidence of tampering and it is still a refusal:
  // an approval that names no bytes authorises a tag, which is the thing the
  // digest exists to prevent.
  const v = checkApprovalIntegrity({ modelId: 'm', modelDigest: undefined }, installed({ m: A }));
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, 'approval_unbound');
});

test('🚨 a model that reports no digest is UNVERIFIABLE, not assumed good', () => {
  // '' means present-but-no-digest, which is a different fact from absent.
  const v = checkApprovalIntegrity({ modelId: 'm', modelDigest: A }, installed({ m: '' }));
  assert.equal(v.ok, false);
  if (!v.ok) {
    assert.equal(v.reason, 'digest_unknown');
    assert.match(v.detail, /unverifiable rather than broken/);
  }
});

test('absent and present-without-digest are distinguishable', () => {
  const absent = checkApprovalIntegrity({ modelId: 'x', modelDigest: A }, installed({}));
  const noDigest = checkApprovalIntegrity({ modelId: 'x', modelDigest: A }, installed({ x: '' }));
  assert.equal(absent.ok, false);
  assert.equal(noDigest.ok, false);
  if (!absent.ok && !noDigest.ok) assert.notEqual(absent.reason, noDigest.reason);
});

test('every failure has a sentence, and none of them blames the user', () => {
  const reasons: IntegrityFailure[] =
    ['digest_mismatch', 'digest_unknown', 'approval_unbound', 'model_absent'];
  for (const r of reasons) {
    const text = INTEGRITY_REASON_TEXT[r];
    assert.ok(text && text.length > 20, `${r} has no sentence`);
    assert.doesNotMatch(text, /\byou\b/i, `${r} blames the user for a server-side fact`);
  }
});
