// MigraPilot — Read-Only Promotion Evidence Bundle (Phase 12.18).
//
// Aggregates the existing sources of truth (promotion status 12.16, safety-invariant manifest 12.12,
// executor precheck 12.15, verification commands 12.13/12.14) into ONE copy-safe safe-read object for
// future human review. CONSUMES existing builders/data — duplicates no redaction/export/checklist
// logic. Enables nothing, executes nothing, writes nothing; EXECUTOR_READY stays false.

import { buildPromotionStatus } from "./promotion-status";
import { SAFETY_INVARIANTS, SAFETY_INVARIANTS_VERSION } from "./safety-invariants";
import { EXECUTOR_PRECHECK_VERSION, EXECUTOR_READY, EXECUTOR_PRECHECKS, pendingPromotionPrechecks } from "./executor-precheck";

export const PROMOTION_EVIDENCE_BUNDLE_VERSION = "12.18.0";

// The read-only verification commands that prove the standing posture (names only — no scripts run here).
export const VERIFICATION_COMMANDS = [
  "pilot:redaction:test",
  "pilot:safety:verify",
  "pilot:precheck:verify",
  "pilot:verify",
  "pilot:ci",
] as const;

export interface CiPosture {
  workflowPath: string;
  workingDirectory: string;
  installCommand: string;
  gateCommand: string;
  pathFilter: string;
  permissions: string;
  applied: boolean;
  externalDependencies: false;
}

// Static CI posture metadata (Phase 12.22/12.23/12.24). Describes the scoped repo-root workflow that
// enforces the local gate in CI. NOT a live GitHub/CI query — pure declared metadata, mirrored by the
// verifier against the actual workflow file.
export const CI_POSTURE: CiPosture = {
  workflowPath: ".github/workflows/migrapilot-pilot-web-gate.yml",
  workingDirectory: "apps/pilot-web",
  installCommand: "npm ci --no-audit --no-fund",
  gateCommand: "npm run pilot:ci",
  pathFilter: "apps/pilot-web/**",
  permissions: "contents: read",
  applied: true,
  externalDependencies: false,
};

export interface PromotionEvidenceBundle {
  bundleVersion: string;
  generatedAt: string;
  executorReady: false;
  executorBlocked: boolean;
  eligibleForExecutionExpected: false;
  safetyInvariantVersion: string;
  safetyInvariantCount: number;
  executorPrecheckVersion: string;
  manifestInSync: boolean;
  precheckTotals: {
    total: number;
    standing: { total: number; satisfied: number; pending: number };
    promotion: { total: number; satisfied: number; pending: number };
  };
  pendingPromotionGates: string[];
  verificationCommands: readonly string[];
  standingGaps: string[];
  blockingFailures: string[];
  ciPosture: CiPosture;
  noExecutionAttestation: string;
  summary: string;
}

export function buildPromotionEvidenceBundle(nowIso: string): PromotionEvidenceBundle {
  const status = buildPromotionStatus(nowIso);
  const pending = pendingPromotionPrechecks().map((p) => p.id);

  // Standing gaps that a human reviewer must weigh before any promotion (not code regressions).
  const standingGaps: string[] = [
    "NEEDS_REAL_SD_ENDPOINT — SDXL live generation unproven until an endpoint is configured (separate track).",
    "No dev-only real-action candidate exists in the registry (all real verbs disabled).",
    "Postgres approvals + ops journal must be re-verified in the target environment before promotion.",
    "Executor lock storage + audit-report generator remain design-only (12.6 / 12.8).",
  ];

  return {
    bundleVersion: PROMOTION_EVIDENCE_BUNDLE_VERSION,
    generatedAt: nowIso,
    executorReady: false,
    executorBlocked: status.executorBlocked,
    eligibleForExecutionExpected: false,
    safetyInvariantVersion: SAFETY_INVARIANTS_VERSION,
    safetyInvariantCount: SAFETY_INVARIANTS.length,
    executorPrecheckVersion: EXECUTOR_PRECHECK_VERSION,
    manifestInSync: status.manifestInSync,
    precheckTotals: status.totals,
    pendingPromotionGates: pending,
    verificationCommands: VERIFICATION_COMMANDS,
    standingGaps,
    blockingFailures: status.blockingFailures,
    ciPosture: CI_POSTURE,
    noExecutionAttestation:
      `No executor exists and none was invoked. EXECUTOR_READY=${EXECUTOR_READY}; eligibleForExecution is hard-false; ` +
      `all ${EXECUTOR_PRECHECKS.filter((p) => p.category === "promotion").length} promotion prechecks remain pending. ` +
      `This bundle is read-only evidence; it enables and executes nothing.`,
    summary: status.summary,
  };
}
