// MigraPilot — dev-only action eligibility policy (Phase 12.4).
//
// READ-ONLY DESIGN. Defines the EXACT gate contract a future dev-only real ops action must satisfy
// before a later CODE PROMOTION could even consider enabling it. This phase enables NO executor and
// executes NOTHING: `eligibleForExecution` is ALWAYS false. The separate `eligibleForFuturePromotion`
// may be true ONLY when every structural gate passes (dev target, enabled+allowed action, prechecks/
// postchecks/rollback present, backends configured) — that means "structurally ready for a future code
// change", never "runnable now". Production/unknown/disabled targets and real verbs can never promote.
// No secrets (env var NAMES only).

import { checkOpsTarget, isRealAction } from "./ops-target-allowlist";
import { OPS_ACTION_REGISTRY, isRegistryDisabledAction, type OpsActionEntry } from "./ops-action-registry";
import { hazardLookup } from "./ops-provider";
import { approvalStoreName } from "./approval-store";
import { actionJournalStoreName } from "./ops-action-journal";

export type EligibilityStatus = "pass" | "fail" | "partial" | "unknown";

export interface EligibilityInput {
  targetId: string;
  actionName: string;
  serviceName?: string;
  intendedEnvironment?: string;
  requirePostgresBackends?: boolean;
  requireHealthCheck?: boolean;
}

export interface EligibilityGate {
  name: string;
  status: EligibilityStatus;
  required: boolean;
  evidence: string;
}

export interface EligibilityResult {
  eligibilityId: string;
  targetId: string;
  actionName: string;
  serviceName?: string;
  eligibleForExecution: false;
  eligibleForFuturePromotion: boolean;
  status: EligibilityStatus;
  gates: EligibilityGate[];
  blockers: string[];
  warnings: string[];
  requiredCodePromotionSteps: string[];
  requiredRuntimeEnv: string[];
  requiredApprovalPolicy: string[];
  requiredPrechecks: string[];
  requiredPostchecks: string[];
  hazards: string[];
  generatedAt: string;
}

export const OPS_ELIGIBILITY_POLICY_VERSION = "12.4.0";

function elId(seed: string): string {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) + h + seed.charCodeAt(i)) >>> 0;
  return "el_" + h.toString(36);
}

function findEntry(actionName: string): OpsActionEntry | undefined {
  return OPS_ACTION_REGISTRY.find((a) => a.actionName === actionName);
}

function overall(gates: EligibilityGate[]): EligibilityStatus {
  const req = gates.filter((g) => g.required);
  if (req.some((g) => g.status === "fail")) return "fail";
  if (req.some((g) => g.status === "unknown")) return "unknown";
  if (gates.some((g) => g.status === "fail" || g.status === "unknown" || g.status === "partial")) return "partial";
  return "pass";
}

// The static list of gates the policy evaluates (used by preview — no evaluation, no mutation).
export const ELIGIBILITY_GATE_NAMES = [
  "target-exists", "target-enabled", "environment-dev", "production-never-eligible",
  "action-registered", "action-enabled-in-registry", "action-allowed-by-target", "action-not-denied-by-target",
  "real-action-not-enabled", "approval-store-backend", "ops-journal-backend",
  "required-prechecks-present", "required-postchecks-present", "health-url-allowlist",
  "rollback-note-present", "hazards-reviewed", "operator-confirmation-required",
] as const;

// READ-ONLY. Lists the eligibility gates that would be evaluated. Evaluates nothing; mutates nothing.
export function previewEligibility(input: EligibilityInput): {
  valid: boolean;
  targetId: string;
  actionName: string;
  version: string;
  gates: string[];
  eligibleForExecution: false;
  note: string;
} {
  const targetId = String(input.targetId ?? "").trim();
  const actionName = String(input.actionName ?? "").trim();
  return {
    valid: targetId.length > 0 && actionName.length > 0,
    targetId: targetId || "(unspecified)",
    actionName: actionName || "(unspecified)",
    version: OPS_ELIGIBILITY_POLICY_VERSION,
    gates: [...ELIGIBILITY_GATE_NAMES],
    eligibleForExecution: false,
    note: "READ-ONLY preview — lists the eligibility gates only. Nothing is evaluated or mutated. eligibleForExecution is false in this phase.",
  };
}

// READ-ONLY. Evaluates target/action against the eligibility policy. Mutates nothing; no approval card.
export async function checkEligibility(input: EligibilityInput, nowIso: string): Promise<EligibilityResult> {
  const targetId = String(input.targetId ?? "").trim();
  const actionName = String(input.actionName ?? "").trim();
  const serviceName = input.serviceName ? String(input.serviceName).trim() : undefined;
  const requirePg = input.requirePostgresBackends === true;
  const requireHealth = input.requireHealthCheck === true;
  const intendedEnv = input.intendedEnvironment ? String(input.intendedEnvironment).trim().toLowerCase() : undefined;

  const tg = checkOpsTarget(targetId, actionName, nowIso);
  const entry = findEntry(actionName);
  const realAction = isRealAction(actionName);
  const registryDisabled = isRegistryDisabledAction(actionName);
  const env = tg.environment ?? "unknown";
  const apprStore = approvalStoreName();
  const jrnStore = actionJournalStoreName();
  const healthAllowlistConfigured = !!(process.env.PILOT_OPS_ALLOWED_HEALTH_URLS && process.env.PILOT_OPS_ALLOWED_HEALTH_URLS.trim());

  const hz = await hazardLookup(serviceName || targetId);
  const hazards = [...new Set([...tg.hazards, ...(entry?.hazards ?? []), ...hz.matches.map((m) => `${m.doc} › ${m.heading}: ${m.snippet}`)])];
  const requiredPrechecks = [...new Set([...tg.requiredPrechecks, ...(entry?.prerequisites ?? [])])];
  const requiredPostchecks = [...new Set([...tg.requiredPostchecks, ...(entry?.verificationRecommendations ?? [])])];

  const gates: EligibilityGate[] = [
    { name: "target-exists", required: true, status: tg.found ? "pass" : "fail", evidence: tg.found ? "target present in the allowlist" : "target not found in the allowlist" },
    { name: "target-enabled", required: true, status: tg.found && tg.enabled ? "pass" : "fail", evidence: tg.enabled ? "target enabled" : "target disabled (or not found)" },
    { name: "environment-dev", required: true, status: env === "dev" ? "pass" : env === "unknown" ? "fail" : "fail", evidence: env === "dev" ? "dev environment" : `environment is '${env}' — dev only is permitted` },
    { name: "production-never-eligible", required: true, status: env === "production" ? "fail" : "pass", evidence: env === "production" ? "production target — NEVER eligible" : "not a production target" },
    { name: "action-registered", required: true, status: entry ? "pass" : "fail", evidence: entry ? "action present in the controlled registry" : "action not in the controlled registry" },
    { name: "action-enabled-in-registry", required: true, status: entry?.enabled && !registryDisabled ? "pass" : "fail", evidence: entry?.enabled ? "action enabled in the registry" : registryDisabled ? "action is DISABLED in the registry" : "action not registered" },
    { name: "action-allowed-by-target", required: true, status: tg.actionAllowed ? "pass" : "fail", evidence: tg.actionAllowed ? "action in target.allowedActionNames" : "action NOT in target.allowedActionNames" },
    { name: "action-not-denied-by-target", required: true, status: tg.actionDenied ? "fail" : "pass", evidence: tg.actionDenied ? "action is in target.deniedActionNames" : "action not denied by target" },
    { name: "real-action-not-enabled", required: true, status: realAction ? "fail" : "pass", evidence: realAction ? "real infra-mutating verb — NOT promotable in this phase (no executor exists)" : "not a real infra-mutating verb" },
    { name: "approval-store-backend", required: requirePg, status: apprStore === "postgres" ? "pass" : requirePg ? "fail" : "partial", evidence: `approval store backend: ${apprStore}${apprStore === "memory" ? " (verified in 12.1; set PILOT_APPROVAL_STORE=postgres for promotion)" : ""}` },
    { name: "ops-journal-backend", required: requirePg, status: jrnStore === "postgres" ? "pass" : requirePg ? "fail" : "partial", evidence: `ops journal backend: ${jrnStore}${jrnStore === "memory" ? " (verified in 12.1; set PILOT_OPS_ACTION_JOURNAL=postgres for promotion)" : ""}` },
    { name: "required-prechecks-present", required: true, status: requiredPrechecks.length ? "pass" : "fail", evidence: `${requiredPrechecks.length} precheck(s) defined` },
    { name: "required-postchecks-present", required: true, status: requiredPostchecks.length ? "pass" : "fail", evidence: `${requiredPostchecks.length} postcheck(s) defined` },
    { name: "health-url-allowlist", required: requireHealth, status: healthAllowlistConfigured ? "pass" : requireHealth ? "fail" : "partial", evidence: healthAllowlistConfigured ? "PILOT_OPS_ALLOWED_HEALTH_URLS configured" : "health URL allowlist not configured" },
    { name: "rollback-note-present", required: true, status: "pass", evidence: "rollback/recovery considerations are produced by preflight (ops.service_preflight.run)" },
    { name: "hazards-reviewed", required: false, status: hazards.length ? "pass" : "partial", evidence: hazards.length ? `${hazards.length} grounded hazard(s) available for review` : "no grounded hazards matched — review manually" },
    { name: "operator-confirmation-required", required: false, status: "pass", evidence: "policy enforces explicit human operator confirmation at execution time (never auto-satisfied)" },
  ];

  if (intendedEnv && intendedEnv !== "dev") {
    gates.find((g) => g.name === "environment-dev")!.status = "fail";
  }

  const status = overall(gates);
  const blockers = gates.filter((g) => g.required && g.status === "fail").map((g) => `${g.name}: ${g.evidence}`);
  const warnings = gates.filter((g) => !blockers.includes(`${g.name}: ${g.evidence}`) && (g.status === "partial" || (g.status === "unknown" && !g.required))).map((g) => `${g.name}: ${g.evidence}`);

  // Structurally ready for a FUTURE code promotion (never runtime execution) iff no required gate fails.
  const eligibleForFuturePromotion = status !== "fail" && blockers.length === 0;

  const requiredCodePromotionSteps = [
    "Design + ship a dev-only executor module behind a per-action kill flag (default OFF) — separate, reviewed phase.",
    "Flip the action's registry entry executionMode from disabled→real ONLY for the dev target, gated by that flag.",
    "Add the real dev target to PILOT_OPS_TARGET_ALLOWLIST_JSON (environment=dev, enabled, action in allowedActionNames).",
    "Wire ops.service_preflight.run as a HARD precondition (status must be pass) before any execution path.",
    "Route execution through the approval gate (requires_approval) + atomic exact-once claim + ops journal record.",
    "Verify on a dev-only service first; production remains permanently ineligible.",
  ];
  const requiredRuntimeEnv = [
    "DATABASE_URL (dev DB only)",
    "PILOT_APPROVAL_STORE=postgres",
    "PILOT_OPS_ACTION_JOURNAL=postgres",
    "PILOT_OPS_TARGET_ALLOWLIST=enabled",
    "PILOT_OPS_TARGET_ALLOWLIST_JSON (dev target)",
    ...(requireHealth ? ["PILOT_OPS_PROVIDER=local", "PILOT_OPS_ALLOWED_HEALTH_URLS"] : []),
    "<PER_ACTION_KILL_FLAG> (default OFF)",
  ];
  const requiredApprovalPolicy = [
    "classifyPilotAction must classify the executor as requires_approval (never auto-run).",
    "Atomic exact-once claim (re-approval returns 409 / already executed).",
    "Explicit human operator confirmation at execution time.",
    "Every attempt writes one audit record to the ops action journal.",
  ];

  return {
    eligibilityId: elId(`${targetId}|${actionName}|${nowIso}`),
    targetId: targetId || "(unspecified)",
    actionName: actionName || "(unspecified)",
    serviceName,
    eligibleForExecution: false,
    eligibleForFuturePromotion,
    status,
    gates,
    blockers,
    warnings,
    requiredCodePromotionSteps,
    requiredRuntimeEnv,
    requiredApprovalPolicy,
    requiredPrechecks,
    requiredPostchecks,
    hazards,
    generatedAt: nowIso,
  };
}
