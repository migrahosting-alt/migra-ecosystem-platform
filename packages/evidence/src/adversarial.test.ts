/**
 * The adversarial acceptance suite.
 *
 * These are not examples of the machine working. They are the specific ways real
 * work produced confident wrong conclusions during one long run, each rewritten
 * as a case the machine must REFUSE. If any of these ever passes, the enforcement
 * layer has stopped enforcing and the standard is back to being a document.
 *
 * The last case is the counterweight: a rule that refuses everything is as
 * useless as one that accepts everything, so a genuinely sufficient deterministic
 * proof must be allowed through.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { emptyEvidence, type Evidence } from './evidence.js';
import { checkProvenLive, transition } from './transition.js';
import { ClaimLedger } from './ledger.js';

const actor = { id: 'agent', kind: 'agent' as const };

/** A record that would legitimately pass, which each case then damages in ONE way. */
function sound(): Evidence {
  return {
    ...emptyEvidence('the thing does the thing', 'subject', actor),
    requestedRoute: 'POST /api/thing',
    executedRoute: 'POST /api/thing',
    requestedModel: 'model-a',
    executedModel: 'model-a',
    provenance: 'live probe transcript',
    runtimeRevision: 'abc1234',
    outputs: [{ ref: 'out.json', sha256: 'a'.repeat(64) }],
    determinism: 'deterministic',
    sampleCount: 1,
    controls: [{ name: 'break the input', outcome: 'failed_as_expected' }],
    acceptanceChecks: [{ name: 'returns 200', passed: true }],
    liveProbe: 'https://chat.migrateck.com/... 200',
    productFacing: true,
  };
}

const codes = (e: Evidence, o = {}) => checkProvenLive(e, o).map((r) => r.code);

test('the baseline record is genuinely sufficient', () => {
  // Without this, every case below could pass for the wrong reason.
  assert.deepEqual(codes(sound()), []);
});

/* ── 1. "typecheck passed" with empty output ─────────────────────────────── */

test('a check that was never measured cannot be a pass', () => {
  /*
   * The real shape: a command runs, prints nothing, exits 0, and the absence of
   * complaint is read as success. `passed: null` is NOT MEASURED, and the whole
   * point of the machine is that it never becomes pass.
   */
  const evidence: Evidence = {
    ...sound(),
    acceptanceChecks: [{ name: 'typecheck passed', passed: null, detail: 'empty output' }],
  };
  assert.ok(codes(evidence).includes('unmeasured_checks'));

  const result = transition('OBSERVED', 'PROVEN_LIVE', evidence);
  assert.equal(result.ok, false);
});

test('no acceptance checks at all is refused, not treated as nothing-wrong', () => {
  assert.ok(codes({ ...sound(), acceptanceChecks: [] }).includes('no_acceptance_checks'));
});

/* ── 2. requested model A, executed model B ──────────────────────────────── */

test('a silent substitution cannot be proven', () => {
  /*
   * The most convincing kind of wrong answer: everything looks like it worked,
   * and it did — for a model nobody asked for.
   */
  const swapped: Evidence = { ...sound(), requestedModel: 'model-a', executedModel: 'model-b' };
  assert.ok(codes(swapped).includes('route_or_model_divergence'));

  const rerouted: Evidence = { ...sound(), requestedRoute: 'local', executedRoute: 'remote-gpu' };
  assert.ok(codes(rerouted).includes('route_or_model_divergence'));
});

test('a divergence may be allowed only when it is deliberately recorded', () => {
  const rerouted: Evidence = { ...sound(), requestedRoute: 'local', executedRoute: 'remote-gpu' };
  const allowed = codes(rerouted, { allowRouteDivergence: { reason: 'local VRAM insufficient' } });
  assert.deepEqual(allowed, [], 'a justified fallback is expressible');
});

test('an unrecorded executed route is refused even when nothing disagrees', () => {
  assert.ok(codes({ ...sound(), executedRoute: null }).includes('no_executed_route'));
  assert.ok(codes({ ...sound(), runtimeRevision: null }).includes('no_runtime_revision'));
});

/* ── 3. stochastic result, one sample ────────────────────────────────────── */

test('one stochastic sample is an anecdote', () => {
  const single: Evidence = { ...sound(), determinism: 'stochastic', sampleCount: 1 };
  assert.ok(codes(single).includes('insufficient_samples'));

  const replicated: Evidence = { ...sound(), determinism: 'stochastic', sampleCount: 3 };
  assert.deepEqual(codes(replicated), []);
});

test('the replication bar is configurable but not removable', () => {
  const two: Evidence = { ...sound(), determinism: 'stochastic', sampleCount: 2 };
  assert.deepEqual(codes(two, { replicationThreshold: 2 }), []);
  assert.ok(codes(two, { replicationThreshold: 6 }).includes('insufficient_samples'));
});

/* ── 4. artefact exists but hash is missing ──────────────────────────────── */

test('an output without a hash is a filename, not a file', () => {
  const unhashed: Evidence = { ...sound(), outputs: [{ ref: 'render.mp4', sha256: null }] };
  assert.ok(codes(unhashed).includes('unhashed_outputs'));
});

/* ── controls: a verifier nobody has seen fail ───────────────────────────── */

test('a metric that has never failed cannot certify anything', () => {
  assert.ok(codes({ ...sound(), controls: [] }).includes('no_controls'));
  assert.ok(
    codes({ ...sound(), controls: [{ name: 'negative', outcome: 'not_run' }] }).includes('controls_not_run'),
  );
  assert.ok(
    codes({ ...sound(), controls: [{ name: 'negative', outcome: 'passed_unexpectedly' }] })
      .includes('control_did_not_fail'),
    'a control that passed when it should have failed means the verifier cannot discriminate',
  );
});

/* ── product claims need the product ─────────────────────────────────────── */

test('a product-facing claim needs live evidence, not a passing suite', () => {
  assert.ok(codes({ ...sound(), liveProbe: null }).includes('no_live_probe'));
  // Infrastructure claims are not held to a live product probe.
  assert.deepEqual(codes({ ...sound(), liveProbe: null, productFacing: false }), []);
});

/* ── 5. a claim later disproven ──────────────────────────────────────────── */

test('withdrawal preserves the original evidence and the fact it was believed', () => {
  const ledger = new ClaimLedger();
  const original: Evidence = {
    ...sound(),
    claim: 'wardrobe systematically fails',
    determinism: 'stochastic',
    sampleCount: 2,
  };
  ledger.open('wardrobe', original);

  // Two samples cannot be proven — the machine says so.
  const attempt = ledger.advance('wardrobe', 'PROVEN_LIVE', original);
  assert.equal(attempt.ok, false);
  assert.ok(attempt.refusals.some((r) => r.code === 'insufficient_samples'));

  // The failed attempt is recorded, and the standing status is NOT destroyed.
  assert.equal(ledger.get('wardrobe')!.status, 'INTENT');
  assert.ok(ledger.get('wardrobe')!.history.some((h) => h.to === 'REFUSED'));

  ledger.advance('wardrobe', 'OBSERVED', original);
  ledger.withdraw('wardrobe', 'disproven by 6/6 across 3 fresh seeds', 'wardrobe-v2');

  const withdrawn = ledger.get('wardrobe')!;
  assert.equal(withdrawn.status, 'WITHDRAWN');
  assert.equal(withdrawn.supersededBy, 'wardrobe-v2');
  // The evidence that led to the wrong conclusion is still there to learn from.
  assert.equal(withdrawn.evidence.sampleCount, 2);
  assert.ok(withdrawn.history.some((h) => h.to === 'OBSERVED'));
  assert.ok(ledger.retracted().some((c) => c.id === 'wardrobe'));
});

test('a superseded claim does not disappear and links both ways', () => {
  const ledger = new ClaimLedger();
  ledger.open('v1', { ...sound(), claim: 'old conclusion' });
  ledger.supersede('v1', 'v2', { ...sound(), claim: 'better conclusion' }, 'better sampling');

  assert.equal(ledger.get('v1')!.status, 'SUPERSEDED');
  assert.equal(ledger.get('v1')!.supersededBy, 'v2');
  assert.equal(ledger.get('v2')!.supersedes, 'v1');
});

test('a terminal claim cannot be quietly reopened', () => {
  const ledger = new ClaimLedger();
  ledger.open('done', sound());
  ledger.withdraw('done', 'wrong');
  const reopened = ledger.advance('done', 'PROVEN_LIVE', sound());
  assert.equal(reopened.ok, false);
  assert.ok(reopened.refusals.some((r) => r.code === 'terminal_state'));
});

test('PROVEN_LIVE cannot slide backwards without saying so', () => {
  const back = transition('PROVEN_LIVE', 'OBSERVED', sound());
  assert.equal(back.ok, false);
  // But it can always be retracted.
  assert.equal(transition('PROVEN_LIVE', 'WITHDRAWN', sound()).ok, true);
});

/* ── 6. the counterweight: a sufficient deterministic proof is allowed ───── */

test('one clean deterministic run IS proof when replication is genuinely unnecessary', () => {
  /*
   * The real case: a fixed HTTP assertion against a deployed route. Running it
   * five times proves nothing the first did not, and a machine that refused it
   * would push people to route around the machine — which is how enforcement
   * dies.
   */
  const httpAssertion: Evidence = {
    ...sound(),
    claim: '/authorize never answers internal_error to a valid request',
    determinism: 'deterministic',
    sampleCount: 1,
    controls: [{ name: 'malformed challenge is refused', outcome: 'failed_as_expected' }],
    acceptanceChecks: [
      { name: 'status 302', passed: true },
      { name: 'location is /login?txn=', passed: true },
    ],
  };

  assert.deepEqual(codes(httpAssertion), []);

  const ledger = new ClaimLedger();
  ledger.open('authorize-health', httpAssertion);
  ledger.advance('authorize-health', 'OBSERVED', httpAssertion);
  const promoted = ledger.advance('authorize-health', 'PROVEN_LIVE', httpAssertion);

  assert.equal(promoted.ok, true);
  assert.equal(ledger.get('authorize-health')!.status, 'PROVEN_LIVE');
  assert.equal(ledger.proven().length, 1);
});

test('deterministic still means it actually ran', () => {
  assert.ok(codes({ ...sound(), determinism: 'deterministic', sampleCount: 0 }).includes('no_samples'));
});

test('every refusal is reported at once, not one per attempt', () => {
  // A caller fixing gaps one at a time learns of the next only on the next try.
  const bad: Evidence = {
    ...emptyEvidence('nothing was done', 'subject', actor),
    productFacing: true,
  };
  const refusals = checkProvenLive(bad);
  assert.ok(refusals.length >= 5, `expected many refusals, got ${refusals.length}`);
  assert.ok(refusals.every((r) => r.code && r.reason));
});
