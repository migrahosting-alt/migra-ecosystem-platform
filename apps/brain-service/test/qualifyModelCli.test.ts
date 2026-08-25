/**
 * The governed qualification tool.
 *
 * Being able to RUN this must prove nothing. Every guard below is a way that
 * "SSH access means approval" could sneak back in.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  approverFrom, evidenceUnchanged, approveRequest, revokeRequest,
  signMutation, confirmationText, selectKey, readToken, CliRefusal,
  evidenceRequest, requireExplicitOutcome,
  type EvidenceView,
} from '../src/cli/qualifyModel.js';
import { verifyAssertion, sha256Hex } from '../src/engine/internalAuth/assertion.js';
import { ACTION_MODELS_QUALIFY, SERVICE_QUALIFICATION_CLI } from '../src/engine/internalAuth/config.js';

const KEY = 'k'.repeat(64);
const DIGEST = 'sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

const evidence = (over: Partial<EvidenceView> = {}): EvidenceView => ({
  id: 'ev-1', modelId: 'qwen2.5vl:7b', capability: 'vision',
  modelVersion: '7b-q4', modelDigest: DIGEST, passed: true,
  license: 'Apache-2.0', suite: 'vision-battery-v1', ...over,
});

test('the effective permission is the test, not the role name', () => {
  /*
   * Someone may hold a senior-sounding role that does not carry the grant.
   * Accepting "owner" as a proxy would approve models on the strength of a label.
   */
  assert.throws(
    () => approverFrom({ user_id: 'u1', roles: ['owner'], permissions: ['platform.roles.manage'] }),
    (e: CliRefusal) => e.code === 'not_permitted',
  );
  const ok = approverFrom({ user_id: 'u1', email: 'a@b.test', permissions: [ACTION_MODELS_QUALIFY] });
  assert.equal(ok.approverId, 'user:u1');
});

test('the approver comes from the authority, never from an argument', () => {
  assert.throws(
    () => approverFrom({ permissions: [ACTION_MODELS_QUALIFY] }),
    (e: CliRefusal) => e.code === 'no_identity',
  );
  assert.throws(
    () => approverFrom({ user_id: 'u1' }),
    (e: CliRefusal) => e.code === 'no_permissions',
  );
});

test('a token is required, and only from the environment', () => {
  assert.throws(() => readToken({}), (e: CliRefusal) => e.code === 'no_token');
  assert.equal(readToken({ MIGRAAUTH_TOKEN: ' abc ' }), 'abc');
});

test('without a signing key it refuses rather than sending something unsigned', () => {
  assert.throws(() => selectKey({}), (e: CliRefusal) => e.code === 'no_signing_key');
});

test('the highest key version is used, so rotation needs no code change', () => {
  const chosen = selectKey({
    MIGRAPILOT_QUALIFICATION_SIGNING_KEY_V1: 'a'.repeat(64),
    MIGRAPILOT_QUALIFICATION_SIGNING_KEY_V2: 'b'.repeat(64),
  });
  assert.equal(chosen.keyId, 'v2');
});

test('evidence that changed between preview and signing aborts the approval', () => {
  /*
   * The Brain validates independently, but this closes a different gap: between
   * what the HUMAN read and what the tool signed.
   */
  const shown = evidence();
  assert.equal(evidenceUnchanged(shown, evidence()), true);
  assert.equal(evidenceUnchanged(shown, null), false, 'evidence that vanished is a mismatch');
  for (const changed of [
    evidence({ modelDigest: 'sha256:' + 'f'.repeat(64) }),
    evidence({ modelId: 'llava:latest' }),
    evidence({ modelVersion: '7b-q8' }),
    evidence({ capability: 'reasoning' }),
    evidence({ passed: false }),
    evidence({ id: 'ev-2' }),
  ]) {
    assert.equal(evidenceUnchanged(shown, changed), false, `${JSON.stringify(changed).slice(0, 60)} must abort`);
  }
});

test('only fixed payload shapes can be produced', () => {
  const approve = approveRequest({ modelId: 'm', capability: 'vision', evidenceRunId: 'ev-1' });
  assert.deepEqual(Object.keys(approve.body).sort(), ['capability', 'evidenceRunId', 'modelId']);
  assert.equal(approve.path, '/api/ai/model-qualification/approve');

  const revoke = revokeRequest({ modelId: 'm', capability: 'vision', reason: 'superseded' });
  assert.deepEqual(Object.keys(revoke.body).sort(), ['capability', 'modelId', 'reason']);
});

test('an evidence record carries a stated outcome and a fixed frame', () => {
  const req = evidenceRequest({
    modelId: 'qwen2.5vl:7b', capability: 'vision', suite: 'vision-battery-v1',
    passed: true, modelDigest: DIGEST, results: { cases: 12 },
  });
  assert.equal(req.path, '/api/ai/model-qualification/evidence');
  assert.equal(req.body.passed, true);
  assert.equal(req.body.provider, 'local', 'the common case needs no flag');
  assert.deepEqual(req.body.results, { cases: 12 }, 'the measurement blob passes through unshaped');
  assert.ok(!('environment' in req.body), 'absent stays absent rather than becoming null');
});

test('the outcome of a measurement must be stated, never inferred', () => {
  assert.throws(() => requireExplicitOutcome(false, false), (e: CliRefusal) => e.code === 'bad_usage');
  assert.throws(() => requireExplicitOutcome(true, true), (e: CliRefusal) => e.code === 'bad_usage');
  assert.equal(requireExplicitOutcome(true, false), true);
  assert.equal(requireExplicitOutcome(false, true), false);
});

test('a signed mutation verifies against the Brain, end to end', async () => {
  const request = approveRequest({ modelId: 'qwen2.5vl:7b', capability: 'vision', evidenceRunId: 'ev-1' });
  const signedReq = signMutation({ request, approverId: 'user:u1', keyId: 'v1', key: KEY });

  const presented = JSON.parse(Buffer.from(signedReq.assertionHeader, 'base64').toString('utf8'));
  const out = await verifyAssertion(
    presented,
    { expectedAction: ACTION_MODELS_QUALIFY, method: 'POST', path: request.path, rawBody: signedReq.rawBody },
    {
      keys: new Map([['v1', KEY]]),
      servicePolicy: new Map([[SERVICE_QUALIFICATION_CLI, new Set([ACTION_MODELS_QUALIFY])]]),
      rememberRequestId: async () => true,
    },
  );
  assert.equal(out.ok, true, 'what the CLI signs is exactly what the Brain verifies');
  if (out.ok) {
    assert.equal(out.assertion.serviceId, SERVICE_QUALIFICATION_CLI);
    assert.equal(out.assertion.approverId, 'user:u1');
    assert.equal(out.assertion.bodyDigest, sha256Hex(signedReq.rawBody));
  }
});

test('the validity window is short and generated internally', () => {
  const now = 1_700_000_000_000;
  const req = signMutation({
    request: approveRequest({ modelId: 'm', capability: 'vision', evidenceRunId: 'e' }),
    approverId: 'user:u1', keyId: 'v1', key: KEY, now,
  });
  const a = JSON.parse(Buffer.from(req.assertionHeader, 'base64').toString('utf8'));
  assert.equal(a.issuedAt, now);
  assert.ok(a.expiresAt - a.issuedAt <= 60_000, 'never beyond the Brain ceiling');
  assert.ok(a.expiresAt - a.issuedAt <= 30_000, 'and deliberately tighter still');
  assert.equal(a.v, 1);
});

test('two signings never share a request id', () => {
  const request = approveRequest({ modelId: 'm', capability: 'vision', evidenceRunId: 'e' });
  const a = signMutation({ request, approverId: 'user:u1', keyId: 'v1', key: KEY });
  const b = signMutation({ request, approverId: 'user:u1', keyId: 'v1', key: KEY });
  assert.notEqual(a.requestId, b.requestId);
});

test('the confirmation shows the FULL digest, not a prefix', () => {
  const text = confirmationText({
    action: 'approve', evidence: evidence(), modelId: 'qwen2.5vl:7b',
    capability: 'vision', approverId: 'user:u1', approverEmail: 'a@b.test',
  });
  assert.ok(text.includes(DIGEST), 'approving a tag must visibly mean approving these exact bytes');
  assert.ok(text.includes('vision-battery-v1'));
  assert.ok(text.includes('PASSED'));
  assert.ok(text.includes('Apache-2.0'));
  assert.ok(text.includes('user:u1'));
});

test('nothing secret can appear in what the tool prints', () => {
  const text = confirmationText({
    action: 'approve', evidence: evidence(), modelId: 'm', capability: 'vision',
    approverId: 'user:u1', approverEmail: null,
  });
  for (const secret of [KEY, 'MIGRAAUTH_TOKEN', 'SIGNING_KEY', 'mac']) {
    assert.ok(!text.includes(secret), `${secret} must never be printed`);
  }
});
