// MigraPilot — Executor Pre-Implementation Checklist (Phase 12.15).
//
// DATA ONLY. Maps the executor promotion gates (designs 12.5 / 12.6 / 12.8) and the standing safety
// invariants (12.12) into concrete, auditable preconditions. This file enforces NO runtime behavior,
// enables nothing, and executes nothing. `EXECUTOR_READY` is hard-false: no real executor may be
// implemented until every promotion precheck is satisfied by an explicit human-approved phase.
//
// The consistency verifier (scripts/pilot/verify-executor-precheck.ts) checks this file against the
// manifest version + package scripts. It does NOT re-run the safety gate (npm run pilot:verify does).

export const EXECUTOR_PRECHECK_VERSION = "12.15.0";

// The safety-invariant manifest version this checklist was written against (drift-guarded).
export const MANIFEST_VERSION_REF = "12.12.0";

// The executor remains structurally forbidden until this is deliberately flipped in a future,
// human-approved promotion phase after all `promotion` prechecks below are satisfied.
export const EXECUTOR_READY = false as const;

export type PrecheckCategory = "standing" | "promotion";
export type PrecheckStatus = "satisfied" | "pending";

export interface ExecutorPrecheck {
  id: string;
  requirement: string;
  category: PrecheckCategory;   // standing = already true & must stay green; promotion = must be met before an executor
  satisfiedBy: string;         // an invariant id, a command, or a phase reference (evidence source)
  status: PrecheckStatus;
  blocking: true;              // every precheck blocks executor implementation
}

export const EXECUTOR_PRECHECKS: readonly ExecutorPrecheck[] = [
  // --- Standing safety (satisfied now; must remain green via npm run pilot:ci) ---
  { id: "safe-read-redaction-complete", requirement: "Safe-read output passes through redactPilotValue.", category: "standing", satisfiedBy: "safe-read-surfaces-redacted / pilot:redaction:test", status: "satisfied", blocking: true },
  { id: "report-export-surfaces-redacted", requirement: "Report/journal/diagnostic/export safe-read surfaces are redacted.", category: "standing", satisfiedBy: "safe-read-surfaces-redacted", status: "satisfied", blocking: true },
  { id: "safety-invariant-manifest-green", requirement: "Safety-invariant manifest verifies with 0 violations.", category: "standing", satisfiedBy: "pilot:safety:verify", status: "satisfied", blocking: true },
  { id: "pilot-verify-green", requirement: "Unified read-only gate passes.", category: "standing", satisfiedBy: "pilot:verify", status: "satisfied", blocking: true },
  { id: "pilot-ci-green", requirement: "Typecheck + unified gate passes.", category: "standing", satisfiedBy: "pilot:ci", status: "satisfied", blocking: true },
  { id: "eligible-for-execution-hard-false", requirement: "checkEligibility/previewEligibility return eligibleForExecution:false.", category: "standing", satisfiedBy: "eligible-for-execution-hard-false", status: "satisfied", blocking: true },
  { id: "real-ops-actions-blocked", requirement: "Real ops verbs are registry-disabled and policy-blocked.", category: "standing", satisfiedBy: "real-ops-actions-disabled", status: "satisfied", blocking: true },
  { id: "approval-eligibility-hash-untouched", requirement: "Approval/eligibility/target/preflight hash+eval paths are not redaction-wrapped.", category: "standing", satisfiedBy: "approval-eligibility-paths-not-redaction-wrapped", status: "satisfied", blocking: true },
  { id: "approval-required-tools-nonexecuting", requirement: "requires_approval tools gate but do no real infra work.", category: "standing", satisfiedBy: "requires-approval-internal-only", status: "satisfied", blocking: true },
  { id: "code-paths-not-destructively-redacted", requirement: "Source/code/repo/prompt paths are not redaction-wrapped.", category: "standing", satisfiedBy: "code-paths-not-redacted", status: "satisfied", blocking: true },
  { id: "executor-absent", requirement: "No executor module or tool exists.", category: "standing", satisfiedBy: "executor-absent", status: "satisfied", blocking: true },
  { id: "no-production-target-configured", requirement: "No production target is eligible/configured.", category: "standing", satisfiedBy: "12.2 target allowlist (production never eligible)", status: "satisfied", blocking: true },

  // --- Promotion preconditions (PENDING; all required before any executor is implemented) ---
  { id: "explicit-human-approval", requirement: "Bonex explicitly approves executor implementation.", category: "promotion", satisfiedBy: "future human-approved phase", status: "pending", blocking: true },
  { id: "dev-target-allowlist-finalized", requirement: "A real dev-only target is configured via PILOT_OPS_TARGET_ALLOWLIST_JSON.", category: "promotion", satisfiedBy: "12.2 allowlist + operator config", status: "pending", blocking: true },
  { id: "dev-real-action-candidate", requirement: "Registry has >=1 safe dev-only real-action candidate (currently zero).", category: "promotion", satisfiedBy: "future registry promotion", status: "pending", blocking: true },
  { id: "postgres-approvals-verified-target-env", requirement: "Postgres approval store verified in the target environment.", category: "promotion", satisfiedBy: "12.1 (re-verify in target env)", status: "pending", blocking: true },
  { id: "postgres-journal-verified-target-env", requirement: "Postgres ops journal verified in the target environment.", category: "promotion", satisfiedBy: "12.1 (re-verify in target env)", status: "pending", blocking: true },
  { id: "executor-lock-storage-implemented", requirement: "Execution-lock storage per the 12.6 table sketch.", category: "promotion", satisfiedBy: "12.6 design → future impl", status: "pending", blocking: true },
  { id: "redaction-wired-into-report-generator", requirement: "redactPilotValue wired into the executor audit-report generator.", category: "promotion", satisfiedBy: "12.7/12.8 → future impl", status: "pending", blocking: true },
  { id: "audit-report-schema-implemented", requirement: "Executor audit report per the 12.8 schema, redacted + fail-closed.", category: "promotion", satisfiedBy: "12.8 design → future impl", status: "pending", blocking: true },
  { id: "rollback-runbook-tested", requirement: "Rollback/recovery runbook tested for the candidate action.", category: "promotion", satisfiedBy: "future dev test", status: "pending", blocking: true },
  { id: "health-verification-tested", requirement: "Allowlisted health verification tested for the candidate action.", category: "promotion", satisfiedBy: "future dev test", status: "pending", blocking: true },
  { id: "ui-approval-ux-reviewed", requirement: "Executor approval/warning UX reviewed.", category: "promotion", satisfiedBy: "future UI review", status: "pending", blocking: true },
  { id: "sdxl-live-endpoint-separately-gated", requirement: "SDXL live generation is a separate track (NEEDS_REAL_SD_ENDPOINT), not an executor gate.", category: "promotion", satisfiedBy: "image track / real endpoint", status: "pending", blocking: true },
];

export function pendingPromotionPrechecks(): ExecutorPrecheck[] {
  return EXECUTOR_PRECHECKS.filter((p) => p.category === "promotion" && p.status === "pending");
}
