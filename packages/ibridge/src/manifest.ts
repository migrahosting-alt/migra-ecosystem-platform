/**
 * The iBridge job manifest.
 *
 * ONE JOB DEFINITION, TWO PLACES TO RUN IT. The failure this prevents is drift:
 * a "local implementation" and a separate "RunPod implementation" diverge, and
 * the divergence is discovered as a quality difference nobody can explain. The
 * manifest describes the job completely enough that the allocator's only
 * remaining decision is WHERE — never WHAT.
 *
 * THE MANIFEST IS IMMUTABLE. Everything the allocator and the executor learn is
 * recorded on the JobRecord beside it, so "what was asked for" and "what
 * happened" can be compared afterwards. A structure that lets execution write
 * back into the request cannot answer the one question that matters when a
 * result looks wrong: was this even the job we specified?
 */

import type { HashedArtifact } from '@migrateck/evidence';

/** What the job needs from whatever machine runs it. */
export interface ResourceRequirement {
  vramGb: number;
  ramGb: number;
  storageGb: number;
}

/**
 * The request. Written once, never mutated.
 */
export interface JobManifest {
  jobId: string;
  /** What the job is for, in capability terms rather than tool terms. */
  capability: string;

  requestedModel: string;
  requestedRuntime: string;

  required: ResourceRequirement;

  expectedInputBytes: number;
  expectedOutputBytes: number;

  maxLatencySeconds: number;
  /** Hard ceiling. Exceeding it refuses BEFORE anything is provisioned. */
  maxCostUsd: number;

  /**
   * The canonical inputs, hashed at the source.
   *
   * These are the reference values every later comparison is made against. A
   * transferred copy whose hash differs is a different input, whatever the
   * filename says.
   */
  inputs: HashedArtifact[];
  /** What the job is expected to produce, by reference. */
  expectedOutputs: string[];

  /**
   * Where results belong permanently.
   *
   * Remote compute is ephemeral and must never become canonical storage — a
   * worker that disappears takes anything left on it, and a result that only
   * exists on a rented machine was never really produced.
   */
  canonicalDestination: string;
}

/** What the local machine can actually do, measured rather than assumed. */
export interface LocalProbe {
  /** Whether the local runtime supports this capability at all. */
  capable: boolean;
  available: ResourceRequirement;
  /** Why not, when `capable` is false. */
  reason?: string;
}

/** A remote worker that could be provisioned. */
export interface RemoteCandidate {
  id: string;
  gpuType: string;
  available: ResourceRequirement;
  usdPerHour: number;
  /** How long this candidate is expected to take for this job. */
  estimatedSeconds: number;
}

/** A worker that actually came up, as reported by the provider. */
export interface ProvisionedWorker {
  id: string;
  gpuType: string;
  available: ResourceRequirement;
  usdPerHour: number;
}

export type ExecutionRoute = 'local' | 'remote';

/**
 * What actually happened, recorded beside the manifest.
 *
 * Every field is nullable and starts null. Absence means NOT MEASURED — never
 * success — which is the same rule the evidence layer enforces and the reason
 * this record cannot be built optimistically.
 */
export interface JobRecord {
  manifest: JobManifest;

  localProbe: LocalProbe | null;
  allocatorDecision: AllocationDecision | null;

  executedRoute: ExecutionRoute | null;
  chosenGpuType: string | null;
  provisionedWorker: ProvisionedWorker | null;

  /** Hashes of the inputs AS THEY ARRIVED at the executor. */
  transferredInputs: HashedArtifact[];

  executedModel: string | null;
  executedRuntimeRevision: string | null;

  outputs: HashedArtifact[];
  runtimeSeconds: number | null;
  actualCostUsd: number | null;

  /** Whether the ephemeral worker was actually destroyed. */
  teardown: 'succeeded' | 'failed' | 'not_applicable' | null;

  /** The evidence object governing this job, once one exists. */
  evidenceId: string | null;
}

export type AllocationDecision =
  | { route: 'local'; reason: string }
  | { route: 'remote'; candidate: RemoteCandidate; reason: string }
  | { route: 'refused'; refusals: { code: string; reason: string }[] };

export function newJobRecord(manifest: JobManifest): JobRecord {
  return {
    manifest,
    localProbe: null,
    allocatorDecision: null,
    executedRoute: null,
    chosenGpuType: null,
    provisionedWorker: null,
    transferredInputs: [],
    executedModel: null,
    executedRuntimeRevision: null,
    outputs: [],
    runtimeSeconds: null,
    actualCostUsd: null,
    teardown: null,
    evidenceId: null,
  };
}

/** Does a machine meet every resource line of the requirement? */
export function satisfies(available: ResourceRequirement, required: ResourceRequirement): boolean {
  return (
    available.vramGb >= required.vramGb &&
    available.ramGb >= required.ramGb &&
    available.storageGb >= required.storageGb
  );
}

/** Worst-case cost of a candidate for this job, used for the pre-launch ceiling. */
export function projectedCostUsd(candidate: RemoteCandidate): number {
  return (candidate.usdPerHour * candidate.estimatedSeconds) / 3600;
}
