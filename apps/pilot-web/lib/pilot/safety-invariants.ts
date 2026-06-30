// MigraPilot — Ops-Safety Invariant Manifest (Phase 12.12).
//
// Machine-readable freeze of the CURRENT safety posture. This is data only: it enables nothing,
// executes nothing, and changes no policy/eligibility/approval behavior. The companion verifier
// (scripts/pilot/verify-safety-invariants.ts) checks these invariants against the live
// policy/registry/tool posture, read-only. Human-readable companion:
// docs/pilot/ops-safety-invariants-phase-12-12.md

export const SAFETY_INVARIANTS_VERSION = "12.12.0";

export type InvariantSeverity = "critical" | "high" | "medium";

export interface SafetyInvariant {
  id: string;
  description: string;
  machineCheckable: boolean;
  severity: InvariantSeverity;
}

export const SAFETY_INVARIANTS: readonly SafetyInvariant[] = [
  { id: "executor-absent", description: "No real-action executor module or tool exists.", machineCheckable: true, severity: "critical" },
  { id: "eligible-for-execution-hard-false", description: "checkEligibility/previewEligibility always return eligibleForExecution:false.", machineCheckable: true, severity: "critical" },
  { id: "real-ops-actions-disabled", description: "Every real ops verb is registry-disabled and policy-blocked; only controlled no-op/marker/webhook are enabled.", machineCheckable: true, severity: "critical" },
  { id: "safe-read-no-approval", description: "safe_read tools never require approval and create no approval card.", machineCheckable: true, severity: "high" },
  { id: "requires-approval-internal-only", description: "requires_approval tools (noop/marker/webhook) gate but perform no real infrastructure work.", machineCheckable: true, severity: "high" },
  { id: "approval-eligibility-paths-not-redaction-wrapped", description: "Approval/eligibility/target/preflight routes are NOT redaction-wrapped (preserve hash/eval integrity).", machineCheckable: true, severity: "high" },
  { id: "safe-read-surfaces-redacted", description: "Report/journal/diagnostic/export safe-read routes pass output through safeJson.", machineCheckable: true, severity: "high" },
  { id: "code-paths-not-redacted", description: "Source/code/repo/prompt routes are NOT redaction-wrapped (avoid corrupting content).", machineCheckable: true, severity: "high" },
  { id: "image-generate-approval-gated", description: "image.generate is requires_approval.", machineCheckable: true, severity: "high" },
  { id: "image-diagnostics-safe-read", description: "image.health and image.preview are safe_read.", machineCheckable: true, severity: "medium" },
  { id: "sdxl-live-unproven-unless-configured", description: "SDXL live generation is unproven; the image provider is disabled by default until an endpoint is configured (NEEDS_REAL_SD_ENDPOINT).", machineCheckable: false, severity: "medium" },
] as const;
