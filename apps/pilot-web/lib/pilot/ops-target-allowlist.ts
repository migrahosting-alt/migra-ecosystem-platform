// MigraPilot — dev-only ops target allowlist (Phase 12.2).
//
// Defines the HARD eligibility gate that any FUTURE real ops action must pass before it could ever
// execute. This phase enables NO real action and executes nothing: `eligible` is ALWAYS false here.
// Production targets are never eligible; unknown/disabled targets are never eligible. No secrets.
//
// Env:
//   PILOT_OPS_TARGET_ALLOWLIST       "disabled" (default) | "enabled"
//   PILOT_OPS_TARGET_ALLOWLIST_JSON  optional inline JSON array of extra dev targets (no secrets)

export type TargetEnvironment = "dev" | "staging" | "production";

export interface OpsTargetEntry {
  targetId: string;
  label: string;
  environment: TargetEnvironment;
  enabled: boolean;
  allowedActionNames: string[];
  deniedActionNames: string[];
  riskLevel: "low" | "medium" | "high";
  serviceType?: string;
  healthUrls: string[];
  requiredPrechecks: string[];
  requiredPostchecks: string[];
  hazards: string[];
  ownerNote?: string;
  source?: string;
}

export const OPS_TARGET_ALLOWLIST_VERSION = "12.2.0";

// Real infra-mutating action names — NEVER eligible in this phase (and most are blocked by policy).
const REAL_ACTION_NAMES = new Set([
  "ops.restart", "ops.deploy", "ops.suspend", "ops.resume", "ops.restore",
  "ops.dns.update", "ops.invoice.update", "ops.db.migrate", "ops.ssh", "ops.shell",
  "ops.service.restart", "ops.deploy.execute", "ops.billing.update",
]);
export function isRealAction(name: string): boolean {
  return REAL_ACTION_NAMES.has(name);
}

const ALL_REAL = [...REAL_ACTION_NAMES];

// A single placeholder dev target — DISABLED and non-executable. No real target facts are invented.
const SAMPLE_TARGETS: readonly OpsTargetEntry[] = [
  {
    targetId: "dev-sample-service",
    label: "Sample dev service (placeholder, disabled, non-executable)",
    environment: "dev",
    enabled: false,
    allowedActionNames: [],
    deniedActionNames: ALL_REAL,
    riskLevel: "low",
    serviceType: "example",
    healthUrls: [],
    requiredPrechecks: [
      "Confirm this is a DEV-only service (never production).",
      "Read-only health check passes (ops.health_bundle.run / ops.verify.service).",
      "A dry-run plan + human-only runbook reviewed for the action.",
    ],
    requiredPostchecks: [
      "Post-action read-only verification (ops.verify.service / ops.health_bundle.run).",
      "No error spike; dependent services still route correctly.",
    ],
    hazards: ["Placeholder only — no real target is configured. Do NOT act on it."],
    ownerNote: "Placeholder sample. Disabled. Define real dev targets via PILOT_OPS_TARGET_ALLOWLIST_JSON when ready.",
    source: "Phase 12.2 default (no real target configured)",
  },
];

function allowlistMode(): "disabled" | "enabled" {
  return process.env.PILOT_OPS_TARGET_ALLOWLIST === "enabled" ? "enabled" : "disabled";
}

function sanitizeTargetUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}${u.pathname}`; // drop userinfo + query + fragment
  } catch {
    return "(invalid url)";
  }
}

function parseInlineTargets(): OpsTargetEntry[] {
  const raw = process.env.PILOT_OPS_TARGET_ALLOWLIST_JSON;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t) => t && typeof t === "object" && typeof (t as Record<string, unknown>).targetId === "string")
      .map((t) => {
        const o = t as Record<string, unknown>;
        const env = o.environment === "staging" ? "staging" : o.environment === "production" ? "production" : "dev";
        return {
          targetId: String(o.targetId),
          label: typeof o.label === "string" ? o.label : String(o.targetId),
          environment: env as TargetEnvironment,
          enabled: o.enabled === true,
          allowedActionNames: Array.isArray(o.allowedActionNames) ? o.allowedActionNames.filter((x): x is string => typeof x === "string") : [],
          deniedActionNames: Array.isArray(o.deniedActionNames) ? o.deniedActionNames.filter((x): x is string => typeof x === "string") : [],
          riskLevel: o.riskLevel === "high" ? "high" : o.riskLevel === "medium" ? "medium" : "low",
          serviceType: typeof o.serviceType === "string" ? o.serviceType : undefined,
          healthUrls: Array.isArray(o.healthUrls) ? o.healthUrls.filter((x): x is string => typeof x === "string").map(sanitizeTargetUrl) : [],
          requiredPrechecks: Array.isArray(o.requiredPrechecks) ? o.requiredPrechecks.filter((x): x is string => typeof x === "string") : [],
          requiredPostchecks: Array.isArray(o.requiredPostchecks) ? o.requiredPostchecks.filter((x): x is string => typeof x === "string") : [],
          hazards: Array.isArray(o.hazards) ? o.hazards.filter((x): x is string => typeof x === "string") : [],
          ownerNote: typeof o.ownerNote === "string" ? o.ownerNote : undefined,
          source: "PILOT_OPS_TARGET_ALLOWLIST_JSON",
        } as OpsTargetEntry;
      });
  } catch {
    return [];
  }
}

function loadTargets(): OpsTargetEntry[] {
  return [...SAMPLE_TARGETS.map((t) => ({ ...t })), ...parseInlineTargets()];
}

// Sanitized read-only projection (healthUrls already sanitized; no secrets in entries).
export function listOpsTargets(): { version: string; mode: "disabled" | "enabled"; targets: OpsTargetEntry[] } {
  return {
    version: OPS_TARGET_ALLOWLIST_VERSION,
    mode: allowlistMode(),
    targets: loadTargets().map((t) => ({ ...t, healthUrls: t.healthUrls.map(sanitizeTargetUrl) })),
  };
}

export interface TargetCheckResult {
  targetId: string;
  requestedAction: string;
  found: boolean;
  enabled: boolean;
  environment?: TargetEnvironment;
  isRealAction: boolean;
  actionAllowed: boolean;
  actionDenied: boolean;
  missingPreconditions: string[];
  requiredPrechecks: string[];
  requiredPostchecks: string[];
  hazards: string[];
  targetGatePass: boolean; // would target+action pass the allowlist gate (diagnostic only)
  eligible: false; // ALWAYS false in this phase — no real action executes
  reason: string;
  generatedAt: string;
}

export function checkOpsTarget(targetId: string, actionName: string, nowIso: string): TargetCheckResult {
  const id = String(targetId ?? "").trim();
  const action = String(actionName ?? "").trim();
  const mode = allowlistMode();
  const t = loadTargets().find((x) => x.targetId === id);
  const real = isRealAction(action);

  const found = !!t;
  const enabled = !!t?.enabled;
  const env = t?.environment;
  const actionDenied = !!t && t.deniedActionNames.includes(action);
  const actionAllowed = !!t && t.allowedActionNames.includes(action) && !actionDenied;

  const missing: string[] = [];
  if (mode === "disabled") missing.push("target allowlist is disabled (PILOT_OPS_TARGET_ALLOWLIST)");
  if (!found) missing.push("target not found in the allowlist");
  if (found && !enabled) missing.push("target is disabled");
  if (found && env === "production") missing.push("production targets are never eligible");
  if (found && actionDenied) missing.push("action is in the target's deniedActionNames");
  if (found && !actionAllowed && !actionDenied) missing.push("action is not in the target's allowedActionNames");
  if (real) missing.push("real ops actions are not enabled in MigraPilot (this phase defines the gate only)");

  const targetGatePass = mode === "enabled" && found && enabled && env !== "production" && actionAllowed && !actionDenied;

  let reason: string;
  if (real) reason = "INELIGIBLE: real ops actions are not enabled in MigraPilot (Phase 12.2 defines the eligibility gate only — nothing executes).";
  else if (!found) reason = "INELIGIBLE: unknown target.";
  else if (env === "production") reason = "INELIGIBLE: production targets are never eligible.";
  else if (!enabled) reason = "INELIGIBLE: target is disabled.";
  else if (mode === "disabled") reason = "INELIGIBLE: target allowlist is disabled.";
  else if (actionDenied) reason = "INELIGIBLE: action is explicitly denied for this target.";
  else if (!actionAllowed) reason = "INELIGIBLE: action is not allowed for this target.";
  else reason = "INELIGIBLE: target gate would pass, but no real action is enabled in this phase.";

  return {
    targetId: id || "(unspecified)",
    requestedAction: action || "(unspecified)",
    found,
    enabled,
    environment: env,
    isRealAction: real,
    actionAllowed,
    actionDenied,
    missingPreconditions: missing,
    requiredPrechecks: t?.requiredPrechecks ?? [],
    requiredPostchecks: t?.requiredPostchecks ?? [],
    hazards: t?.hazards ?? [],
    targetGatePass,
    eligible: false,
    reason,
    generatedAt: nowIso,
  };
}
