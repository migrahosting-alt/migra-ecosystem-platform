// MigraPilot — controlled ops action registry (Phase 11.1).
//
// Defines the formal contract for ops actions so future REAL verbs can be promoted one at a time
// from "disabled" to approval-gated execution. This phase enables NO real mutation: only the
// Phase 11.0 controlled no-op is enabled; every real verb is listed as a DISABLED entry that
// cannot execute and cannot create an approval card.
//
// Entries are pure data (no secrets). `requiredEnv` lists env var NAMES only — never values.

export type OpsActionCategory = "noop" | "service" | "deploy" | "dns" | "billing" | "database" | "verification" | "custom";
export type OpsExecutionMode = "noop" | "dry_run" | "disabled" | "internal_journal" | "real";

export interface OpsActionEntry {
  actionName: string;
  category: OpsActionCategory;
  enabled: boolean;
  executionMode: OpsExecutionMode;
  riskLevel: "low" | "medium" | "high";
  requiresApproval: true;
  description: string;
  expectedEffect: string;
  allowedTargets: string[];
  requiredEnv: string[]; // env var NAMES only — never values
  prerequisites: string[];
  hazards: string[];
  verificationRecommendations: string[];
  blockedReason?: string;
}

export const OPS_ACTION_REGISTRY_VERSION = "11.1.0";

const DISABLED_FUTURE_REASON = "Real mutation execution is NOT enabled in MigraPilot. Use the dry-run plan + human-only runbook, then have an operator perform the action and verify with read-only checks.";

export const OPS_ACTION_REGISTRY: readonly OpsActionEntry[] = [
  {
    actionName: "ops.noop.execute",
    category: "noop",
    enabled: true,
    executionMode: "noop",
    riskLevel: "low",
    requiresApproval: true,
    description: "Controlled NO-OP: records an approval-gated, exact-once execution to prove the action rails. Mutates nothing.",
    expectedEffect: "Record a controlled no-op execution only; no external changes.",
    allowedTargets: ["*"],
    requiredEnv: [],
    prerequisites: ["A target and a reason."],
    hazards: [],
    verificationRecommendations: ["ops.noop.verify (confirms the record, mutated:false)"],
  },
  {
    actionName: "ops.status_marker.set",
    category: "verification",
    enabled: true,
    executionMode: "internal_journal",
    riskLevel: "low",
    requiresApproval: true,
    description: "Record an INTERNAL ops status marker (planned/in_progress/verifying/completed/failed/blocked/acknowledged) in the action journal. Internal state only — NO infrastructure mutation.",
    expectedEffect: "Record an internal ops status marker only; no infrastructure mutation.",
    allowedTargets: ["*"],
    requiredEnv: [],
    prerequisites: ["A target, a marker status, and a reason."],
    hazards: [],
    verificationRecommendations: ["ops.status_marker.verify", "ops.status_marker.list"],
  },
  {
    actionName: "ops.service.restart",
    category: "service",
    enabled: false,
    executionMode: "disabled",
    riskLevel: "high",
    requiresApproval: true,
    description: "FUTURE / DISABLED — restart a service via its documented safe procedure.",
    expectedEffect: "(disabled) Would restart a service; NOT enabled.",
    allowedTargets: [],
    requiredEnv: [],
    prerequisites: ["Documented safe restart procedure for the target.", "Confirmed idle state / maintenance window."],
    hazards: ["voip-core: never `fwconsole restart` (duplicate Asterisk / transport-bind failure)."],
    verificationRecommendations: ["ops.health_bundle.run", "ops.verify.service"],
    blockedReason: DISABLED_FUTURE_REASON,
  },
  {
    actionName: "ops.deploy.execute",
    category: "deploy",
    enabled: false,
    executionMode: "disabled",
    riskLevel: "high",
    requiresApproval: true,
    description: "FUTURE / DISABLED — deploy an app/service from its canonical source.",
    expectedEffect: "(disabled) Would deploy; NOT enabled.",
    allowedTargets: [],
    requiredEnv: [],
    prerequisites: ["Canonical source confirmed (often on-host / non-obvious branch).", "Clean scoped build + integrity check."],
    hazards: ["panel-api source-of-truth is ON-HOST.", "Build-integrity: green health gate ≠ correct bytes."],
    verificationRecommendations: ["ops.verify.deploy", "ops.health_bundle.run"],
    blockedReason: DISABLED_FUTURE_REASON,
  },
  {
    actionName: "ops.dns.update",
    category: "dns",
    enabled: false,
    executionMode: "disabled",
    riskLevel: "high",
    requiresApproval: true,
    description: "FUTURE / DISABLED — change a DNS record.",
    expectedEffect: "(disabled) Would edit DNS; NOT enabled.",
    allowedTargets: [],
    requiredEnv: [],
    prerequisites: ["Exact zone/record + current values recorded.", "External-resolver verification plan (no NAT hairpin)."],
    hazards: ["Broad/incorrect records break routing widely."],
    verificationRecommendations: ["ops.verify.url (post-change resolution)"],
    blockedReason: DISABLED_FUTURE_REASON,
  },
  {
    actionName: "ops.billing.update",
    category: "billing",
    enabled: false,
    executionMode: "disabled",
    riskLevel: "high",
    requiresApproval: true,
    description: "FUTURE / DISABLED — change billing/invoice state.",
    expectedEffect: "(disabled) Would change billing; NOT enabled.",
    allowedTargets: [],
    requiredEnv: [],
    prerequisites: ["Canonical billing source confirmed (MigraPay/auth-api).", "Exact amounts/customer confirmed; no unintended customer comms."],
    hazards: ["Billing changes can trigger live customer communication."],
    verificationRecommendations: ["Read-only billing state check (canonical source)"],
    blockedReason: DISABLED_FUTURE_REASON,
  },
  {
    actionName: "ops.db.migrate",
    category: "database",
    enabled: false,
    executionMode: "disabled",
    riskLevel: "high",
    requiresApproval: true,
    description: "FUTURE / DISABLED — run a database migration.",
    expectedEffect: "(disabled) Would run a migration; NOT enabled.",
    allowedTargets: [],
    requiredEnv: [],
    prerequisites: ["Backup + read-only preflight/dry-run.", "Non-destructive, idempotent migration verified on a dev DB first."],
    hazards: ["Stale ORM clients after migration until the app restarts.", "Destructive migrations are irreversible without a backup."],
    verificationRecommendations: ["Read-only schema verification", "ops.health_bundle.run"],
    blockedReason: DISABLED_FUTURE_REASON,
  },
];

const DISABLED_NAMES = new Set(OPS_ACTION_REGISTRY.filter((e) => !e.enabled).map((e) => e.actionName));

export function isRegistryDisabledAction(name: string): boolean {
  return DISABLED_NAMES.has(name);
}

export function registryDisabledReason(name: string): string | undefined {
  return OPS_ACTION_REGISTRY.find((e) => e.actionName === name && !e.enabled)?.blockedReason;
}

// Sanitized, read-only projection for tools/UI. Entries are already secret-free (env NAMES only).
export function listOpsActions(): { version: string; actions: OpsActionEntry[] } {
  return { version: OPS_ACTION_REGISTRY_VERSION, actions: OPS_ACTION_REGISTRY.map((e) => ({ ...e })) };
}
