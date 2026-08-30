/**
 * The machine judging THIS session's own conclusions.
 *
 * A primitive that has only ever been exercised on invented fixtures is
 * untested against the thing it exists for. These are real claims from the run
 * that motivated it, encoded exactly as the evidence stood — including the two
 * that must NOT reach PROVEN_LIVE.
 *
 * If the machine promotes the last two, it is not enforcing anything.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { emptyEvidence, type Evidence } from './evidence.js';
import { checkProvenLive } from './transition.js';
import { ClaimLedger } from './ledger.js';

const agent = { id: 'claude', kind: 'agent' as const };

test('the /authorize health result is provable — and the machine agrees', () => {
  const evidence: Evidence = {
    ...emptyEvidence(
      '/authorize is healthy and never answers internal_error to a valid request',
      'migraauth.authorize',
      agent,
    ),
    requestedRoute: 'GET https://auth.migrateck.com/authorize',
    executedRoute: 'GET https://auth.migrateck.com/authorize',
    provenance: 'scripts/verify-auth-health.mjs, 8/8',
    runtimeRevision: 'b3620c6 (+ later deployed refinements)',
    determinism: 'deterministic',
    sampleCount: 1,
    controls: [
      /*
       * The control that makes the suite meaningful: a malformed PKCE challenge
       * must be REFUSED. Without it, "no internal_error" could equally describe
       * an endpoint that accepts everything.
       */
      { name: 'malformed code_challenge is refused with invalid_request', outcome: 'failed_as_expected' },
    ],
    acceptanceChecks: [
      { name: 'valid /authorize issues a transaction and reaches /login', passed: true },
      { name: 'never internal_error on a valid request', passed: true },
      { name: 'session-cookie branch survives an invalid cookie', passed: true },
      { name: 'branding fails soft', passed: true },
    ],
    liveProbe: 'https://auth.migrateck.com — 8/8 checks',
    productFacing: true,
    knownLimits: [
      'does not cover a non-permitted authenticated caller',
      'does not cover the MFA challenge path',
    ],
  };

  assert.deepEqual(checkProvenLive(evidence), []);

  const ledger = new ClaimLedger();
  ledger.open('authorize-health', evidence);
  assert.equal(ledger.advance('authorize-health', 'PROVEN_LIVE', evidence).ok, true);
});

test('the admin-refusal claim is NOT_MEASURED and must not be promoted', () => {
  /*
   * The honest state: the permission model is visible in the deployed artefact,
   * but no non-permitted authenticated caller was ever tried, because that needs
   * a second identity. Inference is not measurement.
   */
  const evidence: Evidence = {
    ...emptyEvidence(
      'a non-permitted authenticated caller is refused by the admin surface',
      'migraauth.admin',
      agent,
    ),
    requestedRoute: 'GET /v1/admin/users',
    executedRoute: 'GET /v1/admin/users',
    provenance: 'route table read from the deployed artifact',
    runtimeRevision: 'deployed auth-api',
    determinism: 'deterministic',
    sampleCount: 1,
    controls: [{ name: 'second identity with no permission', outcome: 'not_run' }],
    acceptanceChecks: [
      { name: 'every admin route carries a requirePermission guard', passed: true },
      // The one that matters, and it was never run.
      { name: 'authenticated non-permitted caller is refused', passed: null },
    ],
    liveProbe: 'unauthenticated probe only — 401',
    productFacing: false,
  };

  const refusals = checkProvenLive(evidence).map((r) => r.code);
  assert.ok(refusals.includes('unmeasured_checks'), 'the unrun check must block promotion');
  assert.ok(refusals.includes('controls_not_run'), 'a control that was never run must block promotion');

  const ledger = new ClaimLedger();
  ledger.open('admin-refusal', evidence);
  const attempt = ledger.advance('admin-refusal', 'PROVEN_LIVE', evidence);
  assert.equal(attempt.ok, false);
  // It stays where it honestly is, and the refusal is on the record.
  assert.equal(ledger.get('admin-refusal')!.status, 'INTENT');
});

test('the MFA matrix is BLOCKED, which is not a failure and not a pass', () => {
  const evidence: Evidence = {
    ...emptyEvidence('the full MFA matrix passes end to end', 'migraauth.mfa', agent),
    provenance: 'not started — disposable identities unavailable',
    determinism: 'deterministic',
    productFacing: true,
  };

  const ledger = new ClaimLedger();
  ledger.open('mfa-matrix', evidence);
  const blocked = ledger.advance(
    'mfa-matrix',
    'BLOCKED',
    evidence,
    {},
    'needs a disposable subject identity and a separate operator identity',
  );

  assert.equal(blocked.ok, true);
  assert.equal(ledger.get('mfa-matrix')!.status, 'BLOCKED');
  // Blocked work is visible as unproven rather than quietly absent.
  assert.equal(ledger.proven().length, 0);
});

test("this session's own withdrawn claim is preserved, not erased", () => {
  /*
   * Real: I reported the session's commits missing because `git log -6` did not
   * show them, then `merge-base --is-ancestor` proved they were ancestors all
   * along. The ledger has to keep both the wrong conclusion and its correction.
   */
  const ledger = new ClaimLedger();
  const wrong: Evidence = {
    ...emptyEvidence('the session commits are not on the branch', 'repo.history', agent),
    provenance: 'git log --oneline -6',
    determinism: 'deterministic',
    sampleCount: 1,
    productFacing: false,
  };
  ledger.open('commits-lost', wrong);
  ledger.advance('commits-lost', 'OBSERVED', wrong);
  ledger.withdraw('commits-lost', 'merge-base --is-ancestor: YES — log -6 simply did not reach back far enough');

  const claim = ledger.get('commits-lost')!;
  assert.equal(claim.status, 'WITHDRAWN');
  assert.equal(claim.evidence.provenance, 'git log --oneline -6');
  assert.ok(claim.history.some((h) => h.to === 'WITHDRAWN'));
  assert.equal(ledger.retracted().length, 1);
});
