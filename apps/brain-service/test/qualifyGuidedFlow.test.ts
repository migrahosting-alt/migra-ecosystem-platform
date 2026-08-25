/**
 * The operator sign-in and the guided plan.
 *
 * Two properties carry this file: an authorization code from somewhere else
 * cannot be fed to the CLI, and the verdict recorded comes from the evidence
 * rather than from whoever typed the command.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  pkcePair, buildAuthorizeUrl, parseCallback, tokenRequestBody,
  plannedRecords, guidedPlanText, CliRefusal,
  evidenceIdentity, assertOneSubject, recordedMatchesPlan, DIGEST_PATTERN,
} from '../src/cli/qualifyModel.js';

const DIGEST = 'sha256:5ced39dfa4bac325dc183dd1e4febaa1c46b3ea28bce48896c8e69c1e79611cc';

test('the challenge is the S256 hash of the verifier, and both are fresh each time', () => {
  const a = pkcePair();
  const b = pkcePair();
  assert.equal(createHash('sha256').update(a.verifier).digest('base64url'), a.challenge);
  assert.notEqual(a.verifier, b.verifier, 'a reused verifier makes an intercepted code replayable');
  assert.ok(a.verifier.length >= 43, 'RFC 7636 floor');
});

test('the authorization request never carries the verifier', () => {
  const { verifier, challenge } = pkcePair();
  const url = buildAuthorizeUrl({
    authorizeEndpoint: 'https://auth.migrateck.com/authorize',
    clientId: 'migrapilot_qualification_cli',
    redirectUri: 'http://127.0.0.1:4747/callback',
    challenge, state: 'st', scopes: ['openid'],
  });
  assert.ok(!url.includes(verifier), 'sending the verifier is exactly what PKCE avoids');
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('code_challenge_method'), 'S256', 'plain would send the verifier');
  assert.equal(parsed.searchParams.get('response_type'), 'code');
  assert.equal(parsed.searchParams.get('redirect_uri'), 'http://127.0.0.1:4747/callback');
});

test('a callback carrying someone else’s state is refused', () => {
  /*
   * Without this, anything that can reach the loopback port during the window
   * can hand the CLI a code from an authorization the operator never approved.
   */
  assert.throws(
    () => parseCallback('/callback?code=abc&state=attacker', 'mine'),
    (e: CliRefusal) => e.code === 'state_mismatch',
  );
  assert.throws(
    () => parseCallback('/callback?code=abc', 'mine'),
    (e: CliRefusal) => e.code === 'state_mismatch',
    'a missing state is a mismatch, not a pass',
  );
  assert.equal(parseCallback('/callback?code=abc&state=mine', 'mine').code, 'abc');
});

test('an authorization the user declined is reported as declined', () => {
  assert.throws(
    () => parseCallback('/callback?error=access_denied&state=mine', 'mine'),
    (e: CliRefusal) => e.code === 'authorization_denied',
  );
});

test('the token exchange sends the verifier and no secret', () => {
  const body = new URLSearchParams(tokenRequestBody({
    code: 'c1', verifier: 'v1', clientId: 'migrapilot_qualification_cli',
    redirectUri: 'http://127.0.0.1:4747/callback',
  }));
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.get('code_verifier'), 'v1');
  assert.equal(body.get('client_id'), 'migrapilot_qualification_cli');
  // A CLI cannot keep a secret: it ships to an operator's machine.
  assert.equal(body.get('client_secret'), null);
});

// ── the plan ──────────────────────────────────────────────────────────────

/** Identity every evidence record must state about itself. */
const IDENTITY = { model_id: 'qwen2.5vl:7b', model_version: 'Q4_K_M-8.3B', model_digest: DIGEST };

const files = [
  { file: 'A', evidence: { ...IDENTITY, verdict: 'FAILED', suite: 'vision-qualification-v1' } },
  { file: 'B', evidence: { ...IDENTITY, verdict: 'FAILED', suite: 'vision-qualification-v1', capability_under_test: 'vision.object_counting' } },
  { file: 'C', evidence: { ...IDENTITY, verdict: 'PASSED', suite: 'vision-understanding-v1', capability_under_test: 'vision.general' } },
];

test('the verdict comes from the evidence, never from a flag', () => {
  /*
   * `--passed` on the command line would let an operator record a pass for a run
   * that failed, which is the one thing this path exists to make impossible.
   */
  const plan = plannedRecords(files);
  assert.deepEqual(plan.map((p) => p.passed), [false, false, true]);
  assert.deepEqual(plan.map((p) => p.capability), ['vision', 'vision.object_counting', 'vision.general']);
});

test('only the scoped general capability may be approved, and only when it passed', () => {
  const plan = plannedRecords(files);
  assert.deepEqual(plan.filter((p) => p.approve).map((p) => p.capability), ['vision.general']);

  const allFailed = plannedRecords(files.map((f) => ({ ...f, evidence: { ...f.evidence, verdict: 'FAILED' } })));
  assert.equal(allFailed.filter((p) => p.approve).length, 0, 'a failed run can never carry an approval');
});

test('a passed run for a capability outside the scope is recorded but NOT approved', () => {
  // Recording counting as passed would still not approve it here — approval is
  // reserved to the capability this flow was built to grant.
  const plan = plannedRecords([
    { file: 'X', evidence: { ...IDENTITY, verdict: 'PASSED', suite: 's', capability_under_test: 'vision.object_counting' } },
  ]);
  assert.equal(plan[0]!.passed, true);
  assert.equal(plan[0]!.approve, false);
});

test('evidence that does not state a verdict or a suite is refused, not guessed', () => {
  assert.throws(
    () => plannedRecords([{ file: 'X', evidence: { suite: 's' } }]),
    (e: CliRefusal) => e.code === 'unreadable_verdict',
  );
  assert.throws(
    () => plannedRecords([{ file: 'X', evidence: { verdict: 'PASSED' } }]),
    (e: CliRefusal) => e.code === 'unreadable_suite',
  );
});

// ── identity comes from the evidence ──────────────────────────────────────

test('an evidence record that does not name its bytes is refused', () => {
  /*
   * THE BUG THIS FIXES. The staged payloads carried results and no identity;
   * `--model` and `--digest` supplied it on the command line, so the recorded run
   * and the approved bytes were two separate claims that could disagree — and the
   * guided flow, which has no flags, had nothing to read and failed with
   * `no_digest` after the operator had already signed in.
   */
  for (const missing of ['model_id', 'model_version', 'model_digest']) {
    const evidence: Record<string, unknown> = { ...IDENTITY, verdict: 'PASSED', suite: 's' };
    delete evidence[missing];
    assert.throws(
      () => plannedRecords([{ file: 'X', evidence }]),
      (e: CliRefusal) => e.code === 'evidence_incomplete',
      `${missing} must be required`,
    );
  }
});

test('a digest that is not sha256 with 64 hex characters is refused, never normalised', () => {
  for (const bad of ['sha256:abc', DIGEST.toUpperCase(), '5ced39df', 'sha512:' + 'a'.repeat(64), 'latest', '']) {
    assert.throws(
      () => evidenceIdentity('X', { ...IDENTITY, model_digest: bad }),
      (e: CliRefusal) => ['malformed_digest', 'evidence_incomplete'].includes(e.code),
      `${bad || '(empty)'} must not pass`,
    );
  }
  assert.equal(evidenceIdentity('X', IDENTITY).modelDigest, DIGEST);
  assert.ok(DIGEST_PATTERN.test(DIGEST));
});

test('the identity travels on every record, so nothing is re-derived later', () => {
  const plan = plannedRecords(files);
  for (const record of plan) {
    assert.equal(record.modelId, 'qwen2.5vl:7b');
    assert.equal(record.modelDigest, DIGEST);
    assert.equal(record.modelVersion, 'Q4_K_M-8.3B');
  }
});

test('files describing different models cannot be recorded as one subject', () => {
  // Three files about three models would each record cleanly and leave an
  // approval whose evidence chain nobody could follow.
  const mixed = [
    files[0]!,
    { file: 'B', evidence: { ...IDENTITY, model_id: 'llava:latest', verdict: 'FAILED', suite: 's' } },
  ];
  assert.throws(
    () => assertOneSubject(plannedRecords(mixed)),
    (e: CliRefusal) => e.code === 'mixed_subjects',
  );
  assert.equal(assertOneSubject(plannedRecords(files)).modelDigest, DIGEST);
});

test('a recorded run that differs from the plan aborts the approval', () => {
  /*
   * Re-read immediately before signing. The Brain validates independently; this
   * closes the gap between what the operator read and what the store holds.
   */
  const step = plannedRecords(files)[2]!;
  const good = {
    id: 'ev-1', modelId: 'qwen2.5vl:7b', capability: 'vision.general',
    modelVersion: 'Q4_K_M-8.3B', modelDigest: DIGEST, passed: true,
  };
  assert.equal(recordedMatchesPlan(step, good), true);
  assert.equal(recordedMatchesPlan(step, null), false, 'a run that vanished is a mismatch');
  for (const drift of [
    { ...good, modelDigest: 'sha256:' + 'f'.repeat(64) },
    { ...good, modelId: 'llava:latest' },
    { ...good, modelVersion: 'Q8_0-8.3B' },
    { ...good, capability: 'vision' },
    { ...good, passed: false },
  ]) {
    assert.equal(recordedMatchesPlan(step, drift), false, JSON.stringify(drift).slice(0, 70));
  }
});

test('the plan shows the FULL digest and every verdict before anything is signed', () => {
  const text = guidedPlanText({
    modelId: 'qwen2.5vl:7b', version: 'Q4_K_M-8.3B', digest: DIGEST,
    approverId: 'user:u1', approverEmail: 'a@b.test', records: plannedRecords(files),
  });
  assert.ok(text.includes(DIGEST), 'approving a tag must visibly mean approving these exact bytes');
  assert.ok(text.includes('vision-understanding-v1'));
  assert.ok(text.includes('vision-qualification-v1'));
  assert.ok(text.includes('vision.object_counting'));
  assert.match(text, /Then APPROVE: vision\.general/);
  assert.match(text, /stays unqualified and will be refused/);
});

test('a plan that grants nothing says so rather than looking like an approval', () => {
  const text = guidedPlanText({
    modelId: 'm', version: 'v', digest: DIGEST, approverId: 'user:u1', approverEmail: null,
    records: plannedRecords([files[0]!]),
  });
  assert.match(text, /No approval will be granted/);
});
