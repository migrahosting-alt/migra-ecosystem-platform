// MigraPilot — dev-only service preflight (Phase 12.3).
//
// READ-ONLY. Composes the Phase 12.2 target gate + the controlled action registry + environment +
// grounded hazards + an OPTIONAL allowlisted health check + approval/journal readiness into ONE
// preflight verdict. Executes NO infrastructure action. `eligibleForFutureExecution` is ALWAYS false
// in this phase: production/unknown/disabled targets fail, disabled registry actions fail, and every
// real ops verb fails. No secrets, no response bodies.

import { checkOpsTarget, isRealAction } from "./ops-target-allowlist";
import { OPS_ACTION_REGISTRY, isRegistryDisabledAction, registryDisabledReason, type OpsActionEntry } from "./ops-action-registry";
import { buildHealthBundle, hazardLookup, type HealthBundle } from "./ops-provider";
import { approvalStoreName } from "./approval-store";
import { actionJournalStoreName } from "./ops-action-journal";

export type PreflightStatus = "pass" | "fail" | "partial" | "unknown";
export type PreflightAudience = "internal" | "technical" | "executive" | "client";

export interface PreflightInput {
  targetId: string;
  actionName: string;
  serviceName?: string;
  healthUrl?: string;
  expectedText?: string;
  expectedBuildId?: string;
  operatorIntent?: string;
  audience?: PreflightAudience;
}

export interface PreflightCheck {
  name: string;
  status: PreflightStatus;
  evidence: string;
  required: boolean;
}

export interface PreflightResult {
  preflightId: string;
  targetId: string;
  actionName: string;
  serviceName?: string;
  status: PreflightStatus;
  eligibleForFutureExecution: false;
  generatedAt: string;
  checks: PreflightCheck[];
  targetGate: { found: boolean; enabled: boolean; environment?: string; isRealAction: boolean; eligible: false; reason: string };
  registryGate: { registered: boolean; enabled: boolean; executionMode?: string; reason: string };
  environmentGate: { environment: string; allowed: boolean; reason: string };
  healthGate?: { requested: boolean; status: PreflightStatus; summary: string; checks: { name: string; status: string; evidence: string }[] };
  hazards: string[];
  requiredPrechecks: string[];
  requiredPostchecks: string[];
  rollbackConsiderations: string[];
  missingRequirements: string[];
  recommendations: string[];
  citations: string[];
}

function pfId(seed: string): string {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) + h + seed.charCodeAt(i)) >>> 0;
  return "pf_" + h.toString(36);
}

function findRegistryEntry(actionName: string): OpsActionEntry | undefined {
  return OPS_ACTION_REGISTRY.find((a) => a.actionName === actionName);
}

function rollbackFor(category: string | undefined, actionName: string): string[] {
  const k = category ?? (actionName.includes("deploy") ? "deploy" : actionName.includes("dns") ? "dns" : actionName.includes("billing") || actionName.includes("invoice") ? "billing" : actionName.includes("db") || actionName.includes("migrate") ? "database" : actionName.includes("restart") ? "service" : "custom");
  switch (k) {
    case "deploy": return ["Identify the previous known-good release/build and confirm it is re-deployable.", "Confirm canonical source first (often on-host / a non-obvious branch).", "Have a read-only post-deploy verification (build id / health) ready before acting."];
    case "service": return ["Confirm the documented safe restart procedure; avoid duplicate-process hazards (e.g. voip-core).", "Have an immediate Start/recovery path if the restart fails.", "Confirm idle state / maintenance window first."];
    case "dns": return ["Record the exact zone/record + current values before any change.", "Lower TTL beforehand; keep prior values to restore.", "Verify post-change via an EXTERNAL resolver (no NAT hairpin)."];
    case "billing": return ["Confirm the canonical billing source (MigraPay/auth-api) and exact amounts/customer.", "Ensure no unintended customer communications are triggered.", "Record current invoice/subscription state to restore."];
    case "database": return ["Take a backup + run a read-only preflight/dry-run first.", "Migration must be non-destructive & idempotent; verify on a DEV DB first.", "Have a down-migration / restore plan ready."];
    default: return ["Identify a concrete rollback path before any future execution.", "Define a read-only verification to confirm success/failure."];
  }
}

function overall(checks: PreflightCheck[]): PreflightStatus {
  const req = checks.filter((c) => c.required);
  if (req.some((c) => c.status === "fail")) return "fail";
  if (req.some((c) => c.status === "unknown")) return "unknown";
  if (checks.some((c) => c.status === "fail" || c.status === "unknown")) return "partial";
  return "pass";
}

const HEALTH_AUDIENCES = new Set(["internal", "technical", "executive", "client"]);

// READ-ONLY. Lists the checks the run would perform. Executes NO external health check; mutates nothing.
export function previewServicePreflight(input: PreflightInput): {
  valid: boolean;
  targetId: string;
  actionName: string;
  serviceName?: string;
  plannedChecks: string[];
  willCheckHealthUrl: boolean;
  eligibleForFutureExecution: false;
  note: string;
} {
  const targetId = String(input.targetId ?? "").trim();
  const actionName = String(input.actionName ?? "").trim();
  const serviceName = input.serviceName ? String(input.serviceName).trim() : undefined;
  const willCheckHealthUrl = !!(input.healthUrl && String(input.healthUrl).trim());
  const plannedChecks = [
    "Target allowlist gate (found / enabled / environment / eligibility)",
    "Controlled action registry gate (registered / enabled / disabled-reason)",
    "Environment gate (production is never eligible)",
    "Real-action gate (real ops verbs are not enabled)",
    "Grounded hazard lookup (Phase 10.2 ecosystem docs)",
    ...(willCheckHealthUrl ? ["Allowlisted health URL check (sanitized; no response body)"] : ["Health URL check (skipped — none provided)"]),
    "Approval store readiness (informational)",
    "Ops journal readiness (informational)",
  ];
  return {
    valid: targetId.length > 0 && actionName.length > 0,
    targetId: targetId || "(unspecified)",
    actionName: actionName || "(unspecified)",
    serviceName,
    plannedChecks,
    willCheckHealthUrl,
    eligibleForFutureExecution: false,
    note: "READ-ONLY preview — no checks executed, nothing mutated. eligibleForFutureExecution is false in this phase.",
  };
}

// READ-ONLY. Runs the read-only checks (incl. an optional allowlisted health check). Mutates nothing.
export async function runServicePreflight(input: PreflightInput, nowIso: string): Promise<PreflightResult> {
  const targetId = String(input.targetId ?? "").trim();
  const actionName = String(input.actionName ?? "").trim();
  const serviceName = input.serviceName ? String(input.serviceName).trim() : undefined;
  const audience = HEALTH_AUDIENCES.has(String(input.audience ?? "").toLowerCase()) ? (String(input.audience).toLowerCase() as PreflightAudience) : "internal";

  const tg = checkOpsTarget(targetId, actionName, nowIso);
  const entry = findRegistryEntry(actionName);
  const realAction = isRealAction(actionName);
  const registryDisabled = isRegistryDisabledAction(actionName);

  const checks: PreflightCheck[] = [];

  // 1. Target gate (required)
  const targetOk = tg.found && tg.enabled && tg.environment !== "production";
  checks.push({ name: "target-allowlist", status: targetOk ? "pass" : "fail", evidence: tg.found ? (tg.enabled ? (tg.environment === "production" ? "production target — never eligible" : `target found, enabled (${tg.environment})`) : "target is disabled") : "target not found in the allowlist", required: true });

  // 2. Registry gate (required)
  let registryStatus: PreflightStatus; let registryReason: string;
  if (registryDisabled) { registryStatus = "fail"; registryReason = registryDisabledReason(actionName) ?? "action is DISABLED in the controlled action registry"; }
  else if (entry && entry.enabled) { registryStatus = "pass"; registryReason = `registered + enabled (${entry.executionMode})`; }
  else if (!entry) { registryStatus = "unknown"; registryReason = "action is not registered in the controlled action registry"; }
  else { registryStatus = "fail"; registryReason = "action is registered but disabled"; }
  checks.push({ name: "action-registry", status: registryStatus, evidence: registryReason, required: true });

  // 3. Environment gate (required)
  const env = tg.environment ?? "unknown";
  const envAllowed = env === "dev" || env === "staging";
  checks.push({ name: "environment", status: env === "production" ? "fail" : envAllowed ? "pass" : "unknown", evidence: env === "production" ? "production targets are never eligible" : envAllowed ? `${env} environment` : "unknown environment (target not found)", required: true });

  // 4. Real-action gate (required) — real ops verbs are not enabled in this phase
  checks.push({ name: "real-action", status: realAction ? "fail" : "pass", evidence: realAction ? "real ops action — execution is NOT enabled in MigraPilot (this phase defines preflight only)" : "not a real infra-mutating verb", required: true });

  // 5. Grounded hazards
  const hz = await hazardLookup(serviceName || targetId);
  const hazards = [...new Set([...tg.hazards, ...(entry?.hazards ?? []), ...hz.matches.map((m) => `${m.doc} › ${m.heading}: ${m.snippet}`)])];
  checks.push({ name: "hazards", status: hazards.length ? "partial" : "unknown", evidence: hazards.length ? `${hazards.length} grounded hazard(s)/note(s) found` : "no grounded hazards matched (proceed with caution)", required: false });

  // 6. Optional allowlisted health check (sanitized; no body returned)
  let healthGate: PreflightResult["healthGate"];
  if (input.healthUrl && String(input.healthUrl).trim()) {
    const bundle: HealthBundle = await buildHealthBundle({ target: targetId || serviceName || "preflight", serviceName, healthUrls: [String(input.healthUrl)], expectedText: input.expectedText, expectedBuildId: input.expectedBuildId, includeHazards: false, includeTopology: false, audience });
    const hgStatus: PreflightStatus = bundle.status === "pass" ? "pass" : bundle.status === "fail" ? "fail" : bundle.status === "partial" ? "partial" : "unknown";
    healthGate = { requested: true, status: hgStatus, summary: bundle.verificationSummary, checks: bundle.checks.map((c) => ({ name: c.name, status: c.status, evidence: c.evidence })) };
    checks.push({ name: "health-url", status: hgStatus, evidence: bundle.checks.length ? bundle.checks.map((c) => `${c.name}: ${c.status}`).join("; ") : "no health result", required: false });
  } else {
    checks.push({ name: "health-url", status: "unknown", evidence: "no allowlisted health URL provided", required: false });
  }

  // 7. Readiness (informational)
  const apprStore = approvalStoreName();
  const jrnStore = actionJournalStoreName();
  checks.push({ name: "approval-store-readiness", status: "pass", evidence: `approval store backend: ${apprStore}`, required: false });
  checks.push({ name: "ops-journal-readiness", status: "pass", evidence: `ops journal backend: ${jrnStore}`, required: false });

  const requiredPrechecks = [...new Set([...tg.requiredPrechecks, ...(entry?.prerequisites ?? [])])];
  const requiredPostchecks = [...new Set([...tg.requiredPostchecks, ...(entry?.verificationRecommendations ?? [])])];
  const rollbackConsiderations = rollbackFor(entry?.category, actionName);

  const missingRequirements = [
    ...tg.missingPreconditions,
    ...(registryStatus === "fail" || registryStatus === "unknown" ? [`registry: ${registryReason}`] : []),
    ...(realAction ? ["real ops execution is not enabled in MigraPilot"] : []),
  ];

  const recommendations = [
    "Real ops execution is NOT enabled — use the dry-run plan + human-only runbook, then have an operator perform the action.",
    "Re-run this preflight after each precondition is satisfied; all required checks must pass before execution would ever be considered.",
    ...(healthGate && healthGate.status === "unknown" ? ["Configure PILOT_OPS_PROVIDER + PILOT_OPS_ALLOWED_HEALTH_URLS to enable the allowlisted health check."] : []),
  ];

  const citations = [...new Set(["Phase 12.2 target allowlist (eligibility gate)", "Phase 10.2 ecosystem docs (topology/hazards)", ...hz.matches.map((m) => m.doc)])];

  return {
    preflightId: pfId(`${targetId}|${actionName}|${nowIso}`),
    targetId: targetId || "(unspecified)",
    actionName: actionName || "(unspecified)",
    serviceName,
    status: overall(checks),
    eligibleForFutureExecution: false,
    generatedAt: nowIso,
    checks,
    targetGate: { found: tg.found, enabled: tg.enabled, environment: tg.environment, isRealAction: tg.isRealAction, eligible: false, reason: tg.reason },
    registryGate: { registered: !!entry, enabled: !!entry?.enabled, executionMode: entry?.executionMode, reason: registryReason },
    environmentGate: { environment: env, allowed: envAllowed, reason: env === "production" ? "production is never eligible" : envAllowed ? "dev/staging permitted for preflight only" : "unknown environment" },
    healthGate,
    hazards,
    requiredPrechecks,
    requiredPostchecks,
    rollbackConsiderations,
    missingRequirements,
    recommendations,
    citations,
  };
}
