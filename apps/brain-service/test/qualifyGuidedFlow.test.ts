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

const files = [
  { file: 'A', evidence: { verdict: 'FAILED', suite: 'vision-qualification-v1', model_digest: DIGEST } },
  { file: 'B', evidence: { verdict: 'FAILED', suite: 'vision-qualification-v1', capability_under_test: 'vision.object_counting' } },
  { file: 'C', evidence: { verdict: 'PASSED', suite: 'vision-understanding-v1', capability_under_test: 'vision.general' } },
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
    { file: 'X', evidence: { verdict: 'PASSED', suite: 's', capability_under_test: 'vision.object_counting' } },
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
