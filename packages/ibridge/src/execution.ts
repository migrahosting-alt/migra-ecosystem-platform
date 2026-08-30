/**
 * Execution controls: what must hold before, during and after a job runs.
 *
 * THE ORDER IS THE SAFETY. Inputs are verified before compute is spent on them;
 * outputs are verified before the worker is destroyed; the job cannot be closed
 * until the worker is gone. Reversing any of those loses either money or the
 * only copy of a result.
 *
 * REMOTE COMPUTE IS EPHEMERAL AND NEVER CANONICAL. A rented machine is a place
 * work happens, not a place results live. Everything here is arranged so a
 * worker can vanish at any moment without taking anything that matters with it.
 */

import type { HashedArtifact, Refusal } from '@migrateck/evidence';
import {
  satisfies,
  type JobManifest,
  type JobRecord,
  type ProvisionedWorker,
} from './manifest.js';

/**
 * Does the worker that actually came up match what was authorised?
 *
 * Providers substitute. A request for one GPU type can be answered with
 * another, and the job will run — on hardware nobody evaluated, at a price
 * nobody approved. Checked against the MANIFEST, not against the request that
 * produced the worker, so a substitution cannot validate itself.
 */
export function verifyWorker(
  manifest: JobManifest,
  expectedGpuType: string,
  worker: ProvisionedWorker,
): Refusal[] {
  const refusals: Refusal[] = [];

  if (worker.gpuType !== expectedGpuType) {
    refusals.push({
      code: 'worker_gpu_mismatch',
      reason: `authorised ${expectedGpuType} but provider supplied ${worker.gpuType}.`,
    });
  }

  if (!satisfies(worker.available, manifest.required)) {
    refusals.push({
      code: 'worker_undersized',
      reason: `worker has ${worker.available.vramGb}GB VRAM; manifest requires ${manifest.required.vramGb}GB.`,
    });
  }

  return refusals;
}

/**
 * Did the exact inputs arrive?
 *
 * Compared by CONTENT. A transfer that truncates, re-encodes or silently
 * substitutes produces a file with the right name and different bytes, and the
 * job then runs correctly on the wrong data — which is indistinguishable from a
 * model quality problem when the results come back odd.
 */
export function verifyTransferredInputs(
  manifest: JobManifest,
  transferred: HashedArtifact[],
): Refusal[] {
  const refusals: Refusal[] = [];
  const arrived = new Map(transferred.map((t) => [t.ref, t.sha256]));

  for (const input of manifest.inputs) {
    if (!arrived.has(input.ref)) {
      refusals.push({ code: 'input_missing', reason: `input ${input.ref} never arrived.` });
      continue;
    }
    const got = arrived.get(input.ref)!;
    if (got === null) {
      refusals.push({
        code: 'input_unhashed',
        reason: `input ${input.ref} arrived without a hash, so it cannot be verified.`,
      });
      continue;
    }
    if (input.sha256 === null) {
      refusals.push({
        code: 'canonical_input_unhashed',
        reason: `canonical input ${input.ref} has no hash to compare against.`,
      });
      continue;
    }
    if (got !== input.sha256) {
      refusals.push({
        code: 'input_hash_mismatch',
        reason: `input ${input.ref} changed in transit (${input.sha256.slice(0, 12)}… → ${got.slice(0, 12)}…).`,
      });
    }
  }

  return refusals;
}

/**
 * Everything that must hold before the worker may be destroyed.
 *
 * OUTPUTS ARE VERIFIED WHILE THE WORKER STILL EXISTS. Once it is gone, an
 * unverifiable result cannot be re-fetched, re-hashed or re-run without paying
 * for the whole job again.
 */
export function verifyOutputs(manifest: JobManifest, record: JobRecord): Refusal[] {
  const refusals: Refusal[] = [];
  const produced = new Map(record.outputs.map((o) => [o.ref, o.sha256]));

  for (const expected of manifest.expectedOutputs) {
    if (!produced.has(expected)) {
      refusals.push({ code: 'output_missing', reason: `expected output ${expected} was not produced.` });
      continue;
    }
    if (produced.get(expected) === null) {
      refusals.push({
        code: 'output_unhashed',
        reason: `output ${expected} exists but was never hashed — a filename is not the file.`,
      });
    }
  }

  if (record.executedModel === null) {
    refusals.push({ code: 'no_executed_model', reason: 'the model that actually ran was not recorded.' });
  } else if (record.executedModel !== manifest.requestedModel) {
    refusals.push({
      code: 'model_mismatch',
      reason: `manifest requested ${manifest.requestedModel} but ${record.executedModel} executed.`,
    });
  }

  if (record.executedRuntimeRevision === null) {
    refusals.push({
      code: 'no_runtime_revision',
      reason: 'the runtime revision that ran was not recorded.',
    });
  }

  return refusals;
}

/**
 * Should the worker be destroyed?
 *
 * NOT ALWAYS. A worker holding outputs that failed verification is the only
 * place those outputs exist — destroying it turns a recoverable problem into an
 * unrecoverable one, and the cost of keeping a pod alive for an hour is far
 * below the cost of re-running the job blind.
 *
 * A worker with nothing recoverable is torn down immediately, because paying
 * for an idle GPU is the other way this goes wrong.
 */
export function teardownDecision(
  outputVerification: Refusal[],
  record: JobRecord,
): { teardown: boolean; reason: string } {
  const hasRecoverableOutput = record.outputs.some((o) => o.sha256 !== null);

  if (outputVerification.length === 0) {
    return { teardown: true, reason: 'outputs verified and secured; nothing left to recover' };
  }

  if (hasRecoverableOutput) {
    return {
      teardown: false,
      reason:
        'verification failed but recoverable output exists on the worker — destroying it would be the only copy',
    };
  }

  return { teardown: true, reason: 'no recoverable output; an idle worker only costs money' };
}

/**
 * The final gate: may this job be closed and its evidence advanced?
 *
 * A job is not finished when the compute finishes. It is finished when the
 * results are in canonical storage and the rented machine no longer exists.
 */
export function canCloseJob(manifest: JobManifest, record: JobRecord): Refusal[] {
  const refusals: Refusal[] = [...verifyOutputs(manifest, record)];

  if (record.executedRoute === null) {
    refusals.push({ code: 'no_executed_route', reason: 'the route that ran was not recorded.' });
  }

  /*
   * REMOTE JOBS MUST CONFIRM TEARDOWN. "Probably terminated" is how a rented
   * GPU bills for a week. `null` is not measured, and not measured is not done.
   */
  if (record.executedRoute === 'remote') {
    if (record.teardown === null) {
      refusals.push({
        code: 'teardown_unknown',
        reason: 'the worker was never confirmed destroyed.',
      });
    } else if (record.teardown === 'failed') {
      refusals.push({
        code: 'teardown_failed',
        reason: 'the worker is still running; the job cannot be closed while it bills.',
      });
    }

    if (record.actualCostUsd === null) {
      refusals.push({ code: 'no_cost_recorded', reason: 'actual cost was never recorded.' });
    } else if (record.actualCostUsd > manifest.maxCostUsd) {
      refusals.push({
        code: 'cost_exceeded_ceiling',
        reason: `job cost $${record.actualCostUsd.toFixed(2)} against a $${manifest.maxCostUsd.toFixed(2)} ceiling.`,
      });
    }
  }

  return refusals;
}
