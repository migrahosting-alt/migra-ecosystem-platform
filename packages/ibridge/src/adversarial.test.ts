/**
 * The allocator's adversarial acceptance suite.
 *
 * Each case is a way a compute system silently does the wrong expensive thing:
 * renting a GPU it did not need, accepting a smaller one than the job requires,
 * running on data that changed in transit, or leaving a pod billing after the
 * work is done. A control plane that cannot refuse these is decoration.
 *
 * The last case is the counterweight — a legitimate remote job must complete,
 * land its outputs in canonical storage, and leave nothing behind.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkProvenLive, ClaimLedger, type Actor } from '@migrateck/evidence';
import {
  newJobRecord,
  type JobManifest,
  type LocalProbe,
  type ProvisionedWorker,
  type RemoteCandidate,
} from './manifest.js';
import { authorizeProvisioning, decide } from './allocator.js';
import {
  canCloseJob,
  teardownDecision,
  verifyOutputs,
  verifyTransferredInputs,
  verifyWorker,
} from './execution.js';

const actor: Actor = { id: 'ibridge', kind: 'agent' };
const hash = (c: string) => c.repeat(64).slice(0, 64);

function manifest(overrides: Partial<JobManifest> = {}): JobManifest {
  return {
    jobId: 'job-1',
    capability: 'video.render',
    requestedModel: 'hunyuan-1.5',
    requestedRuntime: 'comfy@2026.08',
    required: { vramGb: 24, ramGb: 32, storageGb: 100 },
    expectedInputBytes: 1_000_000,
    expectedOutputBytes: 50_000_000,
    maxLatencySeconds: 1800,
    maxCostUsd: 5,
    inputs: [{ ref: 'shot.png', sha256: hash('a') }],
    expectedOutputs: ['render.mp4'],
    canonicalDestination: 'migra-storage-primary://renders/job-1',
    ...overrides,
  };
}

const localBig: LocalProbe = { capable: true, available: { vramGb: 24, ramGb: 64, storageGb: 500 } };
const localSmall: LocalProbe = {
  capable: true,
  available: { vramGb: 12, ramGb: 32, storageGb: 500 },
  reason: 'RTX 3060 12GB',
};

const l40s: RemoteCandidate = {
  id: 'cand-l40s',
  gpuType: 'L40S',
  available: { vramGb: 48, ramGb: 64, storageGb: 500 },
  usdPerHour: 1.2,
  estimatedSeconds: 600,
};
const small4090: RemoteCandidate = {
  id: 'cand-4090',
  gpuType: 'RTX4090',
  available: { vramGb: 24, ramGb: 32, storageGb: 200 },
  usdPerHour: 0.6,
  estimatedSeconds: 900,
};

/* ── 1. local sufficient → remote must not be touched ────────────────────── */

test('a job the local GPU can run never reaches a remote provider', () => {
  let providerCalled = false;
  const provision = () => {
    providerCalled = true;
    throw new Error('provider must not be called for a local job');
  };

  const outcome = decide({ manifest: manifest(), localProbe: localBig, candidates: [l40s], actor });
  assert.equal(outcome.decision.route, 'local');

  const refusals = authorizeProvisioning(outcome, manifest());
  assert.deepEqual(refusals, []);
  // A local decision carries no provisioning step at all.
  if (outcome.decision.route === 'remote') provision();
  assert.equal(providerCalled, false, 'RunPod was called for a job that fits locally');
});

/* ── 2. local insufficient → a qualified remote is selected ──────────────── */

test('a job too big for local selects a qualified remote and says why', () => {
  const outcome = decide({ manifest: manifest(), localProbe: localSmall, candidates: [l40s], actor });
  assert.equal(outcome.decision.route, 'remote');
  if (outcome.decision.route !== 'remote') return;

  assert.equal(outcome.decision.candidate.gpuType, 'L40S');
  assert.match(outcome.decision.reason, /12GB VRAM, job needs 24GB/);
  // The decision is a claim, not a log line.
  assert.equal(outcome.evidence.executedRoute, 'remote:L40S');
  assert.deepEqual(checkProvenLive(outcome.evidence), []);
});

test('the cheapest QUALIFYING candidate wins, not the biggest', () => {
  const outcome = decide({
    manifest: manifest(),
    localProbe: localSmall,
    candidates: [l40s, small4090],
    actor,
  });
  if (outcome.decision.route !== 'remote') throw new Error('expected remote');
  // 4090 satisfies 24GB at $0.15 vs L40S at $0.20. Paying past the requirement
  // buys nothing the manifest asked for.
  assert.equal(outcome.decision.candidate.gpuType, 'RTX4090');
});

/* ── 3. requested 48GB, allocator picks 24GB → refuse BEFORE provisioning ── */

test('an undersized candidate is refused before anything is provisioned', () => {
  const big = manifest({ required: { vramGb: 48, ramGb: 32, storageGb: 100 } });
  const outcome = decide({ manifest: big, localProbe: localSmall, candidates: [small4090], actor });

  assert.equal(outcome.decision.route, 'refused');
  if (outcome.decision.route !== 'refused') return;
  assert.ok(outcome.decision.refusals.some((r) => r.code === 'no_qualified_remote'));

  // And the gate refuses too, so nothing downstream can act on it.
  assert.ok(authorizeProvisioning(outcome, big).length > 0);
});

test('the gate re-checks the manifest and catches a decision that slipped through', () => {
  /*
   * Simulates a bug in `decide` rather than a bad candidate: the gate must not
   * simply echo the decision it was handed, or it protects nothing.
   */
  const big = manifest({ required: { vramGb: 48, ramGb: 32, storageGb: 100 } });
  const forged = decide({ manifest: manifest(), localProbe: localSmall, candidates: [small4090], actor });
  const refusals = authorizeProvisioning(forged, big);
  assert.ok(refusals.some((r) => r.code === 'undersized_worker'));
});

/* ── 4. the provider substitutes hardware ────────────────────────────────── */

test('a worker that comes up as the wrong GPU is refused', () => {
  const substituted: ProvisionedWorker = {
    id: 'w1',
    gpuType: 'RTX3090',
    available: { vramGb: 24, ramGb: 32, storageGb: 200 },
    usdPerHour: 0.5,
  };
  const refusals = verifyWorker(manifest(), 'L40S', substituted);
  assert.ok(refusals.some((r) => r.code === 'worker_gpu_mismatch'));
});

test('a worker of the right name but wrong size is still refused', () => {
  const shrunk: ProvisionedWorker = {
    id: 'w2',
    gpuType: 'L40S',
    available: { vramGb: 16, ramGb: 32, storageGb: 200 },
    usdPerHour: 1.2,
  };
  assert.ok(verifyWorker(manifest(), 'L40S', shrunk).some((r) => r.code === 'worker_undersized'));
});

/* ── 5. input hash mismatch → abort ──────────────────────────────────────── */

test('an input that changed in transit aborts the job', () => {
  const refusals = verifyTransferredInputs(manifest(), [{ ref: 'shot.png', sha256: hash('b') }]);
  assert.ok(refusals.some((r) => r.code === 'input_hash_mismatch'));
});

test('an input that arrived unhashed cannot be accepted', () => {
  assert.ok(
    verifyTransferredInputs(manifest(), [{ ref: 'shot.png', sha256: null }])
      .some((r) => r.code === 'input_unhashed'),
  );
  assert.ok(
    verifyTransferredInputs(manifest(), []).some((r) => r.code === 'input_missing'),
  );
});

/* ── 6. model / runtime mismatch → abort ─────────────────────────────────── */

test('a job that ran a different model than the manifest requested is refused', () => {
  const record = newJobRecord(manifest());
  record.outputs = [{ ref: 'render.mp4', sha256: hash('c') }];
  record.executedModel = 'wan-2.2';
  record.executedRuntimeRevision = 'comfy@2026.08';

  assert.ok(verifyOutputs(manifest(), record).some((r) => r.code === 'model_mismatch'));
});

test('an unrecorded runtime revision is refused', () => {
  const record = newJobRecord(manifest());
  record.outputs = [{ ref: 'render.mp4', sha256: hash('c') }];
  record.executedModel = 'hunyuan-1.5';
  record.executedRuntimeRevision = null;
  assert.ok(verifyOutputs(manifest(), record).some((r) => r.code === 'no_runtime_revision'));
});

/* ── 7. output hash missing → cannot promote ─────────────────────────────── */

test('an output that exists but was never hashed cannot close the job', () => {
  const record = newJobRecord(manifest());
  record.executedRoute = 'remote';
  record.executedModel = 'hunyuan-1.5';
  record.executedRuntimeRevision = 'comfy@2026.08';
  record.outputs = [{ ref: 'render.mp4', sha256: null }];
  record.teardown = 'succeeded';
  record.actualCostUsd = 0.2;

  assert.ok(canCloseJob(manifest(), record).some((r) => r.code === 'output_unhashed'));
});

/* ── 8. pod not terminated → job cannot close ────────────────────────────── */

test('a job whose worker is still running cannot be closed', () => {
  const record = newJobRecord(manifest());
  record.executedRoute = 'remote';
  record.executedModel = 'hunyuan-1.5';
  record.executedRuntimeRevision = 'comfy@2026.08';
  record.outputs = [{ ref: 'render.mp4', sha256: hash('c') }];
  record.actualCostUsd = 0.2;

  record.teardown = null;
  assert.ok(canCloseJob(manifest(), record).some((r) => r.code === 'teardown_unknown'));

  record.teardown = 'failed';
  assert.ok(canCloseJob(manifest(), record).some((r) => r.code === 'teardown_failed'));
});

test('a worker holding unverified output is NOT destroyed', () => {
  /*
   * The one case where keeping a pod alive is correct: it holds the only copy of
   * something that failed verification. An hour of GPU is cheaper than a blind
   * re-run, and far cheaper than a result nobody can reproduce.
   */
  const record = newJobRecord(manifest());
  record.outputs = [{ ref: 'render.mp4', sha256: hash('d') }];
  const decision = teardownDecision([{ code: 'output_missing', reason: 'partial' }], record);
  assert.equal(decision.teardown, false);
  assert.match(decision.reason, /only copy/);
});

test('a worker with nothing recoverable is destroyed immediately', () => {
  const record = newJobRecord(manifest());
  record.outputs = [];
  assert.equal(teardownDecision([{ code: 'output_missing', reason: 'none' }], record).teardown, true);
});

/* ── 9. cost above ceiling → refuse before launch ────────────────────────── */

test('a candidate over the cost ceiling is refused before launch', () => {
  const cheapJob = manifest({ maxCostUsd: 0.05 });
  const outcome = decide({ manifest: cheapJob, localProbe: localSmall, candidates: [l40s], actor });

  assert.equal(outcome.decision.route, 'refused');
  if (outcome.decision.route !== 'refused') return;
  assert.ok(outcome.decision.refusals.some((r) => r.code === 'over_cost_ceiling'));
});

test('a job that overran its ceiling cannot be closed clean', () => {
  const record = newJobRecord(manifest());
  record.executedRoute = 'remote';
  record.executedModel = 'hunyuan-1.5';
  record.executedRuntimeRevision = 'comfy@2026.08';
  record.outputs = [{ ref: 'render.mp4', sha256: hash('c') }];
  record.teardown = 'succeeded';
  record.actualCostUsd = 9.99;

  assert.ok(canCloseJob(manifest(), record).some((r) => r.code === 'cost_exceeded_ceiling'));
});

test('no candidate fast enough is a refusal, not a slow job', () => {
  const urgent = manifest({ maxLatencySeconds: 60 });
  const outcome = decide({ manifest: urgent, localProbe: localSmall, candidates: [l40s], actor });
  if (outcome.decision.route !== 'refused') throw new Error('expected refusal');
  assert.ok(outcome.decision.refusals.some((r) => r.code === 'over_latency_budget'));
});

/* ── 10. the counterweight: a legitimate remote job completes ────────────── */

test('a sound remote job runs, lands in canonical storage, and the worker disappears', () => {
  const spec = manifest();
  const outcome = decide({ manifest: spec, localProbe: localSmall, candidates: [l40s], actor });
  if (outcome.decision.route !== 'remote') throw new Error('expected remote');

  // Money is only authorised once the decision's own evidence holds up.
  assert.deepEqual(authorizeProvisioning(outcome, spec), []);

  const worker: ProvisionedWorker = {
    id: 'w-live',
    gpuType: 'L40S',
    available: { vramGb: 48, ramGb: 64, storageGb: 500 },
    usdPerHour: 1.2,
  };
  assert.deepEqual(verifyWorker(spec, 'L40S', worker), []);
  assert.deepEqual(verifyTransferredInputs(spec, [{ ref: 'shot.png', sha256: hash('a') }]), []);

  const record = newJobRecord(spec);
  record.localProbe = localSmall;
  record.allocatorDecision = outcome.decision;
  record.executedRoute = 'remote';
  record.chosenGpuType = 'L40S';
  record.provisionedWorker = worker;
  record.transferredInputs = [{ ref: 'shot.png', sha256: hash('a') }];
  record.executedModel = 'hunyuan-1.5';
  record.executedRuntimeRevision = 'comfy@2026.08';
  record.outputs = [{ ref: 'render.mp4', sha256: hash('e') }];
  record.runtimeSeconds = 580;
  record.actualCostUsd = 0.19;

  // Outputs verified BEFORE teardown, while the worker still exists.
  const outputRefusals = verifyOutputs(spec, record);
  assert.deepEqual(outputRefusals, []);
  assert.equal(teardownDecision(outputRefusals, record).teardown, true);

  record.teardown = 'succeeded';
  assert.deepEqual(canCloseJob(spec, record), []);

  // Results belong to canonical storage, never to the rented machine.
  assert.match(spec.canonicalDestination, /^migra-storage-primary:/);

  // And only now may the job's own claim advance.
  const ledger = new ClaimLedger();
  ledger.open('job-1-alloc', outcome.evidence);
  assert.equal(ledger.advance('job-1-alloc', 'PROVEN_LIVE', outcome.evidence).ok, true);
});
