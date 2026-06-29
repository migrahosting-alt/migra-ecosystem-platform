// MigraPilot — ops diagnostics provider (Phase 10.4). READ-ONLY. DISABLED by default.
//
// Provides safe, read-only operational diagnostics: allowlisted URL health checks plus
// grounded topology/hazard lookups sourced from the Phase 10.2 ecosystem docs. It adds NO
// mutation/shell/SSH/deploy/DB/DNS/billing capability and hardcodes NO endpoints/IPs/secrets.
//
// Env:
//   PILOT_OPS_PROVIDER             "disabled" (default) | "local"
//   PILOT_OPS_ALLOWED_HEALTH_URLS  comma-separated allowlist of URLs that may be fetched

import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createActionRecord, listRecentActionRecords, type ActionRecord } from "./ops-action-journal";

const PROVIDER = (process.env.PILOT_OPS_PROVIDER ?? "disabled").toLowerCase();
const ALLOWED_RAW = (process.env.PILOT_OPS_ALLOWED_HEALTH_URLS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const TIMEOUT_MS = 5000;
const ECO_DIR = resolve(process.cwd(), "migrapilot/ecosystem");

export type OpsMode = "disabled" | "local";

export function opsProviderMode(): OpsMode {
  return PROVIDER === "local" ? "local" : "disabled";
}

// Display only scheme+host+path — never userinfo, query, or fragment (no token leakage).
function sanitizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return "(invalid url)";
  }
}

function normForMatch(u: string): string {
  return String(u).trim().replace(/\/+$/, "").toLowerCase();
}
function allowedSet(): Set<string> {
  return new Set(ALLOWED_RAW.map(normForMatch));
}
export function isAllowedUrl(url: string): boolean {
  return allowedSet().has(normForMatch(url));
}

function scrub(msg: string, raw: string): string {
  let out = msg;
  if (raw) out = out.split(raw).join(sanitizeUrl(raw));
  return out.replace(/(https?:\/\/)[^@\s/]*@/gi, "$1<redacted>@").replace(/([?&](?:token|key|api[_-]?key|password|secret)=)[^&\s]+/gi, "$1<redacted>");
}

export interface UrlCheck {
  url: string; // sanitized
  ok: boolean;
  status?: number;
  latencyMs?: number;
  error?: string;
}

export async function checkUrl(rawUrl: string): Promise<UrlCheck> {
  const url = sanitizeUrl(rawUrl);
  if (opsProviderMode() !== "local") return { url, ok: false, error: "ops provider disabled (set PILOT_OPS_PROVIDER=local)" };
  if (!isAllowedUrl(rawUrl)) return { url, ok: false, error: "URL not in PILOT_OPS_ALLOWED_HEALTH_URLS allowlist" };
  const t0 = Date.now();
  try {
    const res = await fetch(rawUrl, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    return { url, ok: res.status < 500, status: res.status, latencyMs: Date.now() - t0 };
  } catch (e) {
    return { url, ok: false, latencyMs: Date.now() - t0, error: scrub(e instanceof Error ? e.message : "request failed", rawUrl) };
  }
}

export interface OpsStatus {
  provider: string;
  status: OpsMode;
  allowedCount: number;
  allowed: string[]; // sanitized
  detail: string;
}
export function opsStatus(): OpsStatus {
  const mode = opsProviderMode();
  const allowed = ALLOWED_RAW.map(sanitizeUrl);
  return {
    provider: mode,
    status: mode,
    allowedCount: allowed.length,
    allowed,
    detail:
      mode === "disabled"
        ? "ops diagnostics disabled (set PILOT_OPS_PROVIDER=local + PILOT_OPS_ALLOWED_HEALTH_URLS to enable health checks)"
        : allowed.length
          ? `ops diagnostics enabled with ${allowed.length} allowlisted health check(s)`
          : "ops diagnostics enabled but no health URLs allowlisted (set PILOT_OPS_ALLOWED_HEALTH_URLS)",
  };
}

// Runs all allowlisted checks (read-only) and summarizes. Caps at 20 checks.
export async function opsHealth(): Promise<OpsStatus & { results: UrlCheck[]; okCount: number }> {
  const base = opsStatus();
  if (base.status !== "local" || ALLOWED_RAW.length === 0) return { ...base, results: [], okCount: 0 };
  const results = await Promise.all(ALLOWED_RAW.slice(0, 20).map((u) => checkUrl(u)));
  return { ...base, results, okCount: results.filter((r) => r.ok).length };
}

// ---- Grounded lookups (read the Phase 10.2 ecosystem docs — no hardcoded facts) ----
async function readEcoDoc(file: string): Promise<string | null> {
  try {
    return await readFile(resolve(ECO_DIR, file), "utf8");
  } catch {
    return null;
  }
}

export async function knownTopology(): Promise<{ available: boolean; source?: string; content?: string; detail: string }> {
  const content = await readEcoDoc("01-server-topology.md");
  if (!content) return { available: false, detail: "topology doc not found (migrapilot/ecosystem/01-server-topology.md). Ingest the ecosystem pack." };
  return { available: true, source: "migrapilot/ecosystem/01-server-topology.md", content: content.slice(0, 6000), detail: "topology summarized from grounded ecosystem docs" };
}

// ---- Dry-run ops action PLANS (Phase 10.5) — generate-only, executes nothing ----
export interface OpsPlan {
  actionType: string;
  target: string;
  dryRun: true;
  riskLevel: "low" | "medium" | "high";
  summary: string;
  prerequisites: string[];
  proposedSteps: string[];
  hazards: string[];
  rollbackConsiderations: string[];
  requiredHumanConfirmation: string[];
  citations: string[];
  generatedAt: string;
}

type PlanTemplate = {
  risk: "low" | "medium" | "high";
  keyword: string;
  summary: (t: string) => string;
  prerequisites: string[];
  steps: (t: string) => string[];
  rollback: string[];
  confirm: string[];
};

// Planning scaffolding ONLY. Concrete facts (hazards, citations) are injected from the grounded
// ecosystem docs at runtime — these templates assert no infrastructure specifics themselves.
const PLAN_TEMPLATES: Record<string, PlanTemplate> = {
  restart: {
    risk: "high", keyword: "restart",
    summary: (t) => `Controlled restart of "${t || "(unspecified service/host)"}"`,
    prerequisites: [
      "Confirm the exact host/service and that it is internal (never a customer tenant).",
      "Run read-only health checks (ops.health / ops.check_url) to capture current state.",
      "Confirm no active in-flight work (e.g. live calls for voip services) and a maintenance window.",
    ],
    steps: (t) => [
      "1. Capture current health and process state (read-only).",
      `2. Review the grounded hazards for ${t || "this service"} (see hazards + citations).`,
      "3. Use ONLY the service's documented safe restart procedure (never an unsafe raw restart).",
      "4. Re-verify health/transports after restart.",
      "5. If unhealthy, execute the documented rollback.",
    ],
    rollback: ["Keep prior known-good config/backups available before restarting.", "Have the documented recovery/start command ready for an operator to run."],
    confirm: ["Operator must confirm the exact host, the safe procedure, and an idle state before any real execution.", "Real execution is NOT performed in this phase (dry-run only)."],
  },
  deploy: {
    risk: "high", keyword: "deploy",
    summary: (t) => `Deployment plan for "${t || "(unspecified app/service)"}"`,
    prerequisites: [
      "Identify the CANONICAL source for this service (frequently on-host or a non-obvious branch — verify, do not assume local/origin).",
      "Confirm the working tree is scoped/clean for this change (no unrelated files).",
      "Build cleanly and verify build integrity (matching BUILD_ID / asset hashes) before shipping.",
    ],
    steps: (t) => [
      "1. Confirm the deploy model + canonical source for this target (see citations).",
      "2. Build in isolation; capture the build identity.",
      `3. Back up the current on-host state for ${t || "the target"}.`,
      "4. Ship only the intended artifact; verify deployed bytes == built bytes.",
      "5. Health-check the live service; roll back from backup if unhealthy.",
    ],
    rollback: ["Snapshot/back up the current release before deploy.", "Keep the previous release available for an instant symlink/restore by an operator."],
    confirm: ["Operator must confirm canonical source, a clean scoped tree, and build integrity before any real deploy.", "Real execution is NOT performed in this phase (dry-run only)."],
  },
  dns: {
    risk: "high", keyword: "dns",
    summary: (t) => `DNS change plan for "${t || "(unspecified domain/record)"}"`,
    prerequisites: [
      "Confirm the exact zone/record and current values (read-only) before proposing a change.",
      "Confirm ownership and that the change will not break existing routing/edge/NAT behavior.",
      "Validate from an off-net resolver (no NAT hairpin internally).",
    ],
    steps: (t) => [
      `1. Read current DNS for ${t || "the target"} (read-only).`,
      "2. Document the exact proposed record delta (type/name/value/TTL).",
      "3. Stage the change with a low TTL where appropriate.",
      "4. Verify resolution from an external resolver.",
      "5. Restore the prior record if anything regresses.",
    ],
    rollback: ["Record the exact prior values before any change.", "Keep TTLs low enough to revert quickly."],
    confirm: ["Operator must confirm zone, exact delta, and external verification plan before any real DNS edit.", "Real execution is NOT performed in this phase (dry-run only)."],
  },
  billing: {
    risk: "high", keyword: "billing",
    summary: (t) => `Billing/invoice change plan for "${t || "(unspecified account/invoice)"}"`,
    prerequisites: [
      "Confirm the canonical billing source for this account (MigraPay/auth-api is canonical; panel proxies it).",
      "Confirm exact amounts/customer; never guess money values.",
      "Confirm no live customer communication is triggered by the change.",
    ],
    steps: (t) => [
      `1. Read the current billing/invoice state for ${t || "the account"} (read-only).`,
      "2. Document the exact proposed change and its customer impact.",
      "3. Route the change through the canonical billing system (not a side store).",
      "4. Verify the resulting state and that no unintended customer comms fired.",
      "5. Reverse/credit per policy if incorrect.",
    ],
    rollback: ["Capture the prior invoice/billing state before any change.", "Know the documented credit/reversal path for an operator."],
    confirm: ["Operator must confirm canonical source, exact amounts, and customer-impact before any real billing change.", "Real execution is NOT performed in this phase (dry-run only)."],
  },
};

export async function buildOpsPlan(actionType: string, target: string): Promise<OpsPlan> {
  const at = String(actionType || "").toLowerCase().trim();
  const tgt = String(target || "").trim();
  const tpl = PLAN_TEMPLATES[at];
  // Pull grounded hazards for the target + the action keyword from the ecosystem docs.
  const hz1 = await hazardLookup(tgt);
  const hz2 = await hazardLookup(tpl ? tpl.keyword : at);
  const seen = new Set<string>();
  const merged = [...hz1.matches, ...hz2.matches].filter((m) => {
    const k = m.doc + "|" + m.heading;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const hazards = merged.map((m) => `[${m.doc}] ${m.heading}`);
  const citations = [...new Set(merged.map((m) => m.doc))];

  if (!tpl) {
    return {
      actionType: at || "(unspecified)", target: tgt || "(unspecified)", dryRun: true, riskLevel: "high",
      summary: `DRY RUN / PLAN ONLY — unsupported action type "${at}". Supported: restart, deploy, dns, billing.`,
      prerequisites: [], proposedSteps: [], hazards: hazards.length ? hazards : ["(no grounded hazard matched)"],
      rollbackConsiderations: [], requiredHumanConfirmation: ["Real execution is NOT performed in this phase (dry-run only)."],
      citations: citations.length ? citations : ["(none)"], generatedAt: new Date().toISOString(),
    };
  }
  return {
    actionType: at, target: tgt || "(unspecified)", dryRun: true, riskLevel: tpl.risk,
    summary: `DRY RUN / PLAN ONLY — ${tpl.summary(tgt)}. No external change is performed.`,
    prerequisites: tpl.prerequisites,
    proposedSteps: tpl.steps(tgt),
    hazards: hazards.length ? hazards : ["(no grounded hazard matched — verify manually before acting)"],
    rollbackConsiderations: tpl.rollback,
    requiredHumanConfirmation: tpl.confirm,
    citations: citations.length ? citations : ["(target not found in ecosystem docs — verify before acting)"],
    generatedAt: new Date().toISOString(),
  };
}

// ---- Post-action verification (Phase 10.6) — READ-ONLY evidence only ----
export type VerifyStatus = "pass" | "fail" | "partial" | "unknown";
export interface VerificationCheck {
  name: string;
  status: VerifyStatus;
  evidence: string;
  latencyMs?: number;
  sanitizedUrl?: string;
}
export interface VerificationResult {
  verificationType: string;
  target: string;
  status: VerifyStatus;
  summary: string;
  checks: VerificationCheck[];
  hazards: string[];
  recommendedNextReadOnlyChecks: string[];
  humanActionRequired: boolean;
  generatedAt: string;
  citations: string[];
}

// Allowlisted GET that also captures a body snippet (used only to test expected text/build id;
// the body is NEVER returned to callers — only match booleans/evidence strings are).
async function fetchEvidence(rawUrl: string): Promise<{ ok: boolean; status?: number; latencyMs?: number; url: string; body?: string; error?: string }> {
  const url = sanitizeUrl(rawUrl);
  if (opsProviderMode() !== "local") return { ok: false, url, error: "ops provider disabled (set PILOT_OPS_PROVIDER=local)" };
  if (!isAllowedUrl(rawUrl)) return { ok: false, url, error: "URL not in PILOT_OPS_ALLOWED_HEALTH_URLS allowlist" };
  const t0 = Date.now();
  try {
    const res = await fetch(rawUrl, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = (await res.text()).slice(0, 20000);
    return { ok: res.status < 500, status: res.status, latencyMs: Date.now() - t0, url, body };
  } catch (e) {
    return { ok: false, url, latencyMs: Date.now() - t0, error: scrub(e instanceof Error ? e.message : "request failed", rawUrl) };
  }
}

async function groundedFor(target: string, extraKeyword?: string): Promise<{ hazards: string[]; citations: string[] }> {
  const a = await hazardLookup(target);
  const b = extraKeyword ? await hazardLookup(extraKeyword) : { matches: [] as HazardMatch[] };
  const seen = new Set<string>();
  const merged = [...a.matches, ...b.matches].filter((m) => {
    const k = m.doc + "|" + m.heading;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { hazards: merged.map((m) => `[${m.doc}] ${m.heading}`), citations: [...new Set(merged.map((m) => m.doc))] };
}

const nowIso = () => new Date().toISOString();

export async function verifyUrl(rawUrl: string): Promise<VerificationResult> {
  const c = await checkUrl(rawUrl);
  const unknown = !!c.error && (c.error.includes("disabled") || c.error.includes("allowlist"));
  const status: VerifyStatus = c.ok ? "pass" : unknown ? "unknown" : "fail";
  return {
    verificationType: "url",
    target: c.url,
    status,
    summary: c.ok ? `URL responded HTTP ${c.status} in ${c.latencyMs}ms` : c.error ?? "URL check failed",
    checks: [{ name: "http", status, evidence: c.ok ? `HTTP ${c.status} in ${c.latencyMs}ms` : c.error ?? "failed", latencyMs: c.latencyMs, sanitizedUrl: c.url }],
    hazards: [],
    recommendedNextReadOnlyChecks: c.ok ? [] : ["Confirm PILOT_OPS_PROVIDER=local and the URL is in PILOT_OPS_ALLOWED_HEALTH_URLS."],
    humanActionRequired: !c.ok,
    generatedAt: nowIso(),
    citations: [],
  };
}

export async function verifyService(name: string, healthUrl?: string): Promise<VerificationResult> {
  const g = await groundedFor(name);
  const checks: VerificationCheck[] = [];
  let healthStatus: VerifyStatus | null = null;
  if (healthUrl) {
    const c = await checkUrl(healthUrl);
    healthStatus = c.ok ? "pass" : c.error && (c.error.includes("disabled") || c.error.includes("allowlist")) ? "unknown" : "fail";
    checks.push({ name: "health-url", status: healthStatus, evidence: c.ok ? `HTTP ${c.status} in ${c.latencyMs}ms` : c.error ?? "failed", latencyMs: c.latencyMs, sanitizedUrl: c.url });
  }
  checks.push({ name: "grounded-knowledge", status: g.citations.length ? "pass" : "unknown", evidence: g.citations.length ? `${g.hazards.length} grounded reference(s) in ecosystem docs` : "no grounded reference found" });
  const status: VerifyStatus = healthStatus ? (healthStatus === "pass" ? "pass" : healthStatus === "fail" ? "fail" : "partial") : "unknown";
  return {
    verificationType: "service",
    target: name || "(unspecified)",
    status,
    summary: healthStatus ? (healthStatus === "pass" ? `${name} health OK; ${g.hazards.length} hazard(s) noted` : `${name} health check did not pass`) : `No health URL provided — grounded knowledge only for ${name || "service"}`,
    checks,
    hazards: g.hazards,
    recommendedNextReadOnlyChecks: healthStatus ? [] : ["Provide an allowlisted health URL for a live check, or run ops.health."],
    humanActionRequired: status !== "pass",
    generatedAt: nowIso(),
    citations: g.citations,
  };
}

export async function verifyDeploy(target: string, opts: { healthUrl?: string; expectedText?: string; expectedBuildId?: string } = {}): Promise<VerificationResult> {
  const g = await groundedFor(target, "deploy");
  const checks: VerificationCheck[] = [];
  if (opts.healthUrl) {
    const ev = await fetchEvidence(opts.healthUrl);
    const hStatus: VerifyStatus = ev.ok ? "pass" : ev.error && (ev.error.includes("disabled") || ev.error.includes("allowlist")) ? "unknown" : "fail";
    checks.push({ name: "health-url", status: hStatus, evidence: ev.ok ? `HTTP ${ev.status} in ${ev.latencyMs}ms` : ev.error ?? "failed", latencyMs: ev.latencyMs, sanitizedUrl: ev.url });
    if (opts.expectedText) {
      const found = !!ev.body && ev.body.includes(opts.expectedText);
      checks.push({ name: "expected-text", status: ev.body ? (found ? "pass" : "fail") : "unknown", evidence: ev.body ? (found ? "expected text present in response" : "expected text NOT found in response") : "no response body to match" });
    }
    if (opts.expectedBuildId) {
      const found = !!ev.body && ev.body.includes(opts.expectedBuildId);
      checks.push({ name: "expected-build-id", status: ev.body ? (found ? "pass" : "fail") : "unknown", evidence: ev.body ? (found ? "expected build id present" : "expected build id NOT found") : "no response body to match" });
    }
  } else {
    checks.push({ name: "health-url", status: "unknown", evidence: "no allowlisted health URL provided — cannot verify the live deployment" });
  }
  checks.push({ name: "deploy-model", status: g.citations.length ? "pass" : "unknown", evidence: g.citations.length ? `grounded deploy model available (${g.citations.join(", ")})` : "no grounded deploy model found" });
  const evidenceChecks = checks.filter((c) => c.name !== "deploy-model").map((c) => c.status);
  const status: VerifyStatus = evidenceChecks.length && evidenceChecks.every((s) => s === "pass") ? "pass" : evidenceChecks.some((s) => s === "fail") ? "fail" : evidenceChecks.some((s) => s === "pass") ? "partial" : "unknown";
  return {
    verificationType: "deploy",
    target: target || "(unspecified)",
    status,
    summary: `Read-only deploy verification for ${target || "(unspecified)"} — ${status.toUpperCase()} from available evidence (NO deploy was performed).`,
    checks,
    hazards: g.hazards,
    recommendedNextReadOnlyChecks: status === "pass" ? ["Spot-check a real user request and confirm logs are clean (read-only)."] : ["Provide an allowlisted health URL + expected build id / route text for stronger evidence.", "Verify deployed bytes match the built artifact per the build-integrity guard."],
    humanActionRequired: status !== "pass",
    generatedAt: nowIso(),
    citations: g.citations,
  };
}

const VERIFY_CHECKLISTS: Record<string, (t: string) => string[]> = {
  restart: (t) => [`Confirm ${t || "the service"} process is running (read-only).`, "Health endpoint returns OK / expected status.", "Required transports/ports are bound.", "No error spike in recent logs.", "Spot-check one real request end-to-end."],
  deploy: (t) => [`Health endpoint for ${t || "the service"} returns OK.`, "Deployed build id / version matches the intended release.", "A known route returns the expected content.", "No 5xx / error spike after rollout.", "Confirm deployed bytes == built artifact (build-integrity)."],
  dns: (t) => [`Resolve ${t || "the record"} from an external resolver (no internal hairpin).`, "Returned value matches the intended record.", "TTL is as expected.", "Dependent services still route correctly."],
  billing: (t) => [`Read current billing/invoice state for ${t || "the account"} (read-only).`, "Resulting amounts/state match the intended change.", "No unintended customer communication fired.", "Canonical billing source reflects the change."],
  generic: (t) => [`Read current state of ${t || "the target"} (read-only).`, "Confirm the observed state matches the intended outcome.", "Check for errors/regressions in dependent systems."],
};

export async function verifyPlan(actionType: string, target: string): Promise<VerificationResult> {
  const at = String(actionType || "").toLowerCase().trim();
  const tgt = String(target || "").trim();
  const g = await groundedFor(tgt, at);
  const checklist = (VERIFY_CHECKLISTS[at] ?? VERIFY_CHECKLISTS.generic)(tgt);
  return {
    verificationType: "plan",
    target: `${at || "action"}:${tgt || "(unspecified)"}`,
    status: "unknown",
    summary: `Read-only verification checklist for a "${at || "generic"}" action on ${tgt || "(unspecified)"} — run these AFTER the human performs the action. No mutation is implied.`,
    checks: checklist.map((step) => ({ name: "verify-step", status: "unknown" as VerifyStatus, evidence: step })),
    hazards: g.hazards,
    recommendedNextReadOnlyChecks: checklist,
    humanActionRequired: true,
    generatedAt: nowIso(),
    citations: g.citations,
  };
}

// ---- Operator runbooks (Phase 10.7) — human-executable command packs, NEVER executed ----
export interface CommandPackItem {
  label: string;
  commandText: string;
  purpose: string;
  riskNote: string;
  requiresHumanConfirmation: true;
}
export interface Runbook {
  runbookId: string;
  actionType: string;
  target: string;
  objective: string;
  dryRun: true;
  executionMode: "human_only";
  riskLevel: "low" | "medium" | "high";
  summary: string;
  prerequisites: string[];
  commandPack: CommandPackItem[];
  hazards: string[];
  rollbackSteps: string[];
  verificationSteps: string[];
  stopConditions: string[];
  requiredHumanConfirmation: string[];
  citations: string[];
  generatedAt: string;
}

export interface RunbookInput {
  actionType: string;
  target: string;
  objective?: string;
  riskLevel?: string;
  includeCommands?: boolean;
  includeRollback?: boolean;
  includeVerification?: boolean;
}

const cmd = (label: string, commandText: string, purpose: string, riskNote: string): CommandPackItem => ({ label, commandText, purpose, riskNote, requiresHumanConfirmation: true });

type RunbookTemplate = {
  risk: "low" | "medium" | "high";
  prerequisites: string[];
  commands: (t: string) => CommandPackItem[];
  rollback: string[];
  stops: (t: string) => string[];
};

// Command text uses placeholders (<target>, <documented procedure>) and references grounded practice —
// it never invents private IPs/paths/credentials/endpoints. Specifics come from the grounded hazards/citations.
const RUNBOOK_TEMPLATES: Record<string, RunbookTemplate> = {
  restart: {
    risk: "high",
    prerequisites: ["Confirm <target> is the correct INTERNAL host/service (never a customer tenant).", "Capture current health (read-only) and confirm no active in-flight work / a maintenance window."],
    commands: (t) => [
      cmd("1. Pre-flight (read-only)", `# capture current health/process state for ${t || "<target>"} before touching it`, "Baseline to compare against after restart", "Skipping this hides whether the restart actually fixed anything"),
      cmd("2. Safe restart", `# use ${t || "<target>"}'s DOCUMENTED safe restart procedure (see hazards). For voip-core use the documented safe wrapper — NEVER 'fwconsole restart'.`, "Restart without duplicate-process / transport-bind hazards", "An unsafe restart can spawn duplicate processes and drop live traffic"),
      cmd("3. Post-verify", `# re-run health checks for ${t || "<target>"}; confirm required transports/ports are bound`, "Confirm real recovery, not just a running process", "A green process is NOT a healthy service"),
    ],
    rollback: ["Keep the last known-good config/backup ready before restarting.", "If unhealthy after restart, follow the documented recovery/start procedure (operator-run)."],
    stops: (t) => [`If ${t || "the target"} has active in-flight work, STOP and reschedule.`, "If the safe procedure is unknown, STOP and confirm it from the runbook hazards/citations first."],
  },
  deploy: {
    risk: "high",
    prerequisites: ["Identify the CANONICAL source for <target> (frequently on-host or a non-obvious branch — verify, do not assume local/origin).", "Confirm a clean, scoped working tree and a clean isolated build."],
    commands: (t) => [
      cmd("1. Confirm canonical source", `# verify the real source repo/branch/path for ${t || "<target>"} (NOT necessarily local or origin/main)`, "Avoid deploying a divergent/stale codebase", "Deploying the wrong source has caused prod outages"),
      cmd("2. Back up current state", `# back up the current on-host release/state for ${t || "<target>"}`, "Enable instant rollback", "No backup = no safe rollback"),
      cmd("3. Build + integrity check", `# build cleanly in isolation, record the build id, then verify deployed bytes == built bytes`, "Defeat the build-integrity hazard", "A green health gate does NOT prove correct bytes shipped"),
      cmd("4. Health + rollback-ready", `# health-check ${t || "<target>"} live; restore the backup if unhealthy`, "Confirm the deploy and stay reversible", "Declaring success on HTTP 200 alone is unsafe"),
    ],
    rollback: ["Snapshot/back up the current release before deploy.", "Keep the previous release available for an instant restore (operator-run)."],
    stops: (t) => [`If the canonical source for ${t || "the target"} is uncertain, STOP and confirm it.`, "If unrelated files would ship, STOP and scope the change first."],
  },
  dns: {
    risk: "high",
    prerequisites: ["Confirm the exact zone/record and current values (read-only).", "Confirm the change will not break existing routing/edge/NAT behavior."],
    commands: (t) => [
      cmd("1. Read current record", `# read current DNS for ${t || "<record>"} (read-only) and record exact prior values`, "Know the exact rollback target", "Changing DNS without recording prior values blocks rollback"),
      cmd("2. Stage the change", `# apply the exact intended record delta for ${t || "<record>"} with a low TTL where appropriate`, "Make a precise, reversible change", "Broad/incorrect records can break routing widely"),
      cmd("3. Verify externally", `# resolve ${t || "<record>"} from an OFF-NET resolver (no internal hairpin)`, "Confirm real external resolution", "Internal hosts can't validate the public path (no NAT hairpin)"),
    ],
    rollback: ["Restore the recorded prior record values.", "Keep TTLs low enough to revert quickly."],
    stops: (t) => [`If ${t || "the record"}'s current values are unknown, STOP and read them first.`, "If dependent services rely on the record, STOP and coordinate."],
  },
  billing: {
    risk: "high",
    prerequisites: ["Confirm the CANONICAL billing source for <target> (MigraPay/auth-api is canonical; panel proxies it).", "Confirm exact amounts/customer; never guess money values."],
    commands: (t) => [
      cmd("1. Read current state", `# read current billing/invoice state for ${t || "<account>"} (read-only)`, "Baseline before any change", "Acting on assumed state risks customer-facing errors"),
      cmd("2. Apply via canonical system", `# make the exact intended change through the canonical billing system (not a side store)`, "Keep one source of truth", "Editing a non-canonical store causes drift"),
      cmd("3. Verify + no-comms", `# verify resulting amounts/state and that NO unintended customer communication fired`, "Confirm correctness + no spam", "Billing changes can trigger live customer comms"),
    ],
    rollback: ["Capture the prior invoice/billing state before any change.", "Use the documented credit/reversal path if incorrect (operator-run)."],
    stops: (t) => [`If exact amounts/customer for ${t || "the account"} are uncertain, STOP.`, "If the change would email/charge a customer unexpectedly, STOP."],
  },
  verify: {
    risk: "low",
    prerequisites: ["Identify what outcome you are verifying for <target>."],
    commands: (t) => [
      cmd("1. Read-only checks", `# run read-only health/state checks for ${t || "<target>"} (use ops.verify.* / ops.health)`, "Gather evidence without changing anything", "None — read-only"),
      cmd("2. Compare to expected", `# compare observed state/build id/route text for ${t || "<target>"} against the intended outcome`, "Decide pass/fail/partial from evidence", "Do not assume success without evidence"),
    ],
    rollback: ["N/A — verification is read-only."],
    stops: (t) => [`If evidence for ${t || "the target"} is inconclusive, mark UNKNOWN and request the missing read-only input.`],
  },
  incident: {
    risk: "high",
    prerequisites: ["Confirm scope/impact of the incident for <target> (read-only).", "Do not mutate prod under pressure without the gating rules."],
    commands: (t) => [
      cmd("1. Triage (read-only)", `# capture current health, recent changes, and error signals for ${t || "<target>"}`, "Understand before acting", "Acting before triage often worsens incidents"),
      cmd("2. Identify likely cause", `# correlate with grounded hazards/recent deploys for ${t || "<target>"}`, "Focus remediation", "Guessing wastes time and risks new breakage"),
      cmd("3. Plan remediation (dry-run)", `# draft the remediation as a dry-run plan (ops.*.plan) for human approval — do NOT execute here`, "Stay on the safe rails", "Live remediation without a plan/approval is high-risk"),
    ],
    rollback: ["Document each step taken so it can be reversed.", "Keep backups/snapshots of anything touched."],
    stops: (t) => [`If impact for ${t || "the target"} is unclear or growing, STOP and escalate.`, "If remediation would touch prod without approval, STOP."],
  },
};

function knownHazardWarnings(action: string, target: string): string[] {
  const t = target.toLowerCase();
  const a = action.toLowerCase();
  const w: string[] = [];
  if ((a === "restart" || a === "incident") && (t.includes("voip") || t.includes("asterisk") || t.includes("pbx") || t.includes("freepbx"))) w.push("⚠ voip-core: NEVER run `fwconsole restart` — it can spawn a duplicate Asterisk and fail to bind transports. Use the documented safe wrapper.");
  if (a === "deploy" || t.includes("panel-api") || t.includes("panel")) w.push("⚠ panel-api source-of-truth is ON-HOST (not local git). NEVER deploy a local repo onto it; back up each on-host file first.");
  if (a === "deploy") w.push("⚠ Build-integrity: a green health gate ≠ correct bytes — verify deployed BUILD_ID / asset hashes match the build.");
  w.push("⚠ Canonical-source trap: confirm the real source repo/branch/path before editing/deploying (often on-host or a non-obvious branch, not origin/main).");
  return w;
}

let rbCounter = 0;
function runbookId(): string {
  rbCounter += 1;
  return `rbk_${Date.now().toString(36)}_${rbCounter.toString(36)}`;
}

function normalizeRiskLevel(v: string | undefined, fallback: "low" | "medium" | "high"): "low" | "medium" | "high" {
  const s = String(v ?? "").toLowerCase();
  return s === "low" || s === "medium" || s === "high" ? s : fallback;
}

export async function buildRunbook(input: RunbookInput): Promise<Runbook> {
  const at = String(input.actionType ?? "").toLowerCase().trim() || "custom";
  const tgt = String(input.target ?? "").trim();
  const objective = String(input.objective ?? "").trim() || "(no objective provided)";
  const tpl = RUNBOOK_TEMPLATES[at];
  const g = await groundedFor(tgt, tpl ? at : undefined);
  // targetKnown must reflect the TARGET specifically (not the action keyword), so an unknown
  // target with a known action ("restart") still triggers the conservative path.
  const targetHits = await hazardLookup(tgt);
  const known = knownHazardWarnings(at, tgt);
  const hazards = [...known, ...g.hazards];
  const targetKnown = tgt.length > 0 && targetHits.matches.length > 0;

  const includeCommands = input.includeCommands !== false;
  const includeRollback = input.includeRollback !== false;
  const includeVerification = input.includeVerification !== false;

  // Conservative runbook when the action is unsupported/custom or the target is unknown.
  if (!tpl || !targetKnown) {
    const reason = !tpl ? `unsupported/custom action "${at}"` : `target "${tgt || "(unspecified)"}" not found in grounded ecosystem docs`;
    return {
      runbookId: runbookId(), actionType: at, target: tgt || "(unspecified)", objective, dryRun: true, executionMode: "human_only",
      riskLevel: normalizeRiskLevel(input.riskLevel, "high"),
      summary: `HUMAN ONLY / NOT EXECUTED — CONSERVATIVE runbook (${reason}). No facts were invented; confirm specifics before acting.`,
      prerequisites: ["Confirm the exact target, its canonical source, and the documented procedure from a trusted source.", "Do not proceed on assumptions — gather read-only evidence first."],
      commandPack: includeCommands ? [cmd("1. Establish facts (read-only)", `# identify the real host/service/source for ${tgt || "<target>"} from trusted docs (no guessing)`, "Avoid acting on unknowns", "Acting on unknown infra is high-risk")] : [],
      hazards: hazards.length ? hazards : ["(no grounded hazard matched — treat as unknown and verify manually)"],
      rollbackSteps: includeRollback ? ["Define a concrete rollback BEFORE any change; if none exists, do not proceed."] : [],
      verificationSteps: includeVerification ? ["Verify the outcome with read-only checks once the human acts (ops.verify.*)."] : [],
      stopConditions: ["Target/procedure is unknown — STOP and confirm real facts before any execution.", "If a step would touch production without a backup/approval, STOP."],
      requiredHumanConfirmation: ["This runbook is HUMAN-ONLY and was NOT executed.", "Operator must confirm every command against trusted sources before running anything."],
      citations: g.citations.length ? g.citations : ["(none — target not in ecosystem docs)"],
      generatedAt: nowIso(),
    };
  }

  const mappedVerify = VERIFY_CHECKLISTS[at] ? at : "generic";
  return {
    runbookId: runbookId(), actionType: at, target: tgt, objective, dryRun: true, executionMode: "human_only",
    riskLevel: normalizeRiskLevel(input.riskLevel, tpl.risk),
    summary: `HUMAN ONLY / NOT EXECUTED — operator runbook for "${at}" on ${tgt}. ${objective}. Every command requires human confirmation; nothing here is executed.`,
    prerequisites: tpl.prerequisites,
    commandPack: includeCommands ? tpl.commands(tgt) : [],
    hazards,
    rollbackSteps: includeRollback ? tpl.rollback : [],
    verificationSteps: includeVerification ? (VERIFY_CHECKLISTS[mappedVerify](tgt)) : [],
    stopConditions: tpl.stops(tgt),
    requiredHumanConfirmation: ["This runbook is HUMAN-ONLY and was NOT executed by MigraPilot.", "Operator must review and confirm each command before running it.", "Real ops mutations remain blocked in MigraPilot."],
    citations: g.citations.length ? g.citations : ["(target not found in ecosystem docs — verify before acting)"],
    generatedAt: nowIso(),
  };
}

export function previewRunbook(input: RunbookInput): { valid: boolean; actionType: string; target: string; objective: string; sections: { commands: boolean; rollback: boolean; verification: boolean }; supportedAction: boolean; summary: string; checklist: string[] } {
  const at = String(input.actionType ?? "").toLowerCase().trim() || "custom";
  const tgt = String(input.target ?? "").trim();
  const supported = !!RUNBOOK_TEMPLATES[at];
  const sections = { commands: input.includeCommands !== false, rollback: input.includeRollback !== false, verification: input.includeVerification !== false };
  const checklist: string[] = [];
  if (!tgt) checklist.push("No target provided — runbook will be conservative with stop conditions.");
  if (!supported) checklist.push(`Action "${at}" is custom/unsupported — runbook will be conservative.`);
  if (sections.commands) checklist.push("Will include a human-only command pack (text only, never executed).");
  if (sections.rollback) checklist.push("Will include rollback steps.");
  if (sections.verification) checklist.push("Will include read-only verification steps.");
  checklist.push("Generation requires approval; output is HUMAN-ONLY and not executed.");
  return {
    valid: true, actionType: at, target: tgt || "(unspecified)", objective: String(input.objective ?? "").trim() || "(no objective provided)",
    sections, supportedAction: supported,
    summary: `Preview: "${at}" runbook for ${tgt || "(unspecified)"} — ${supported ? "supported template" : "conservative"} · sections: ${[sections.commands && "commands", sections.rollback && "rollback", sections.verification && "verification"].filter(Boolean).join(", ") || "summary only"}.`,
    checklist,
  };
}

// ---- Ops evidence reports (Phase 10.8) — READ-ONLY, response-only, writes nothing ----
export interface ReportEvidence {
  type: string;
  title: string;
  summary: string;
  source?: string;
}
export interface OpsReport {
  reportId: string;
  reportType: string;
  title: string;
  target: string;
  audience: string;
  status: "draft";
  generatedAt: string;
  executiveSummary: string;
  scope: string;
  evidence: ReportEvidence[];
  diagnosticsSummary: string;
  hazards: string[];
  actionsTakenOrPlanned: string[];
  verificationSummary: string;
  timeline: string[];
  recommendations: string[];
  limitations: string[];
  nextSteps: string[];
  citations: string[];
}
export interface ReportInput {
  reportType: string;
  title: string;
  target: string;
  objective?: string;
  includeDiagnostics?: boolean;
  includeHazards?: boolean;
  includeRunbook?: boolean;
  includeVerification?: boolean;
  includeTimeline?: boolean;
  audience?: string;
  notes?: string;
}

// Always strip URL userinfo + secret query params. For client/executive audiences also redact
// internal infrastructure detail (IPs, /opt|/etc paths, *-core hostnames).
function stripUrlSecrets(s: string): string {
  return String(s).replace(/(https?:\/\/)[^@\s/]*@/gi, "$1<redacted>@").replace(/([?&](?:token|key|api[_-]?key|password|secret)=)[^&\s]+/gi, "$1<redacted>");
}
function redactInternal(s: string): string {
  return s
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "<ip>") // full IPv4
    .replace(/\b(?:10|172|192)\.[\dx]{1,3}(?:\.[\dx]{1,3}){1,2}\b/gi, "<internal-net>") // partial/wildcard private subnets (e.g. 10.10.0.x)
    .replace(/\/(?:opt|etc|var|root|home)\/[\w./-]+/g, "<internal-path>")
    .replace(/\b[\w-]+-core\b/g, "<internal-host>");
}
function reportScrub(s: string, isClient: boolean): string {
  const base = stripUrlSecrets(s);
  return isClient ? redactInternal(base) : base;
}

let reportCounter = 0;
function reportId(): string {
  reportCounter += 1;
  return `rpt_${Date.now().toString(36)}_${reportCounter.toString(36)}`;
}

const REPORT_TYPES = new Set(["incident", "maintenance", "deployment", "verification", "client_summary", "custom"]);
const REPORT_AUDIENCES = new Set(["internal", "client", "executive", "technical"]);

export function previewReport(input: ReportInput): { valid: boolean; reportType: string; supportedType: boolean; audience: string; target: string; sections: string[]; clientSafe: boolean; summary: string; checklist: string[] } {
  const rt = String(input.reportType ?? "").toLowerCase().trim() || "custom";
  const aud = REPORT_AUDIENCES.has(String(input.audience ?? "").toLowerCase()) ? String(input.audience).toLowerCase() : "internal";
  const tgt = String(input.target ?? "").trim();
  const isClient = aud === "client" || aud === "executive" || rt === "client_summary";
  const sections = [
    input.includeDiagnostics !== false && "diagnostics",
    input.includeHazards !== false && "hazards",
    input.includeRunbook !== false && "actions/runbook",
    input.includeVerification !== false && "verification",
    input.includeTimeline !== false && "timeline",
  ].filter(Boolean) as string[];
  const checklist = [
    REPORT_TYPES.has(rt) ? `Supported report type: ${rt}.` : `Custom/unsupported type "${rt}" — generic report.`,
    `Audience: ${aud}${isClient ? " (internal infrastructure detail will be redacted)" : ""}.`,
    tgt ? `Target: ${tgt}.` : "No target — report will mark target as unspecified.",
    "READ-ONLY: returns report content only; writes no file and executes nothing.",
  ];
  return { valid: true, reportType: rt, supportedType: REPORT_TYPES.has(rt), audience: aud, target: tgt || "(unspecified)", sections, clientSafe: isClient, summary: `Preview: "${rt}" report for ${tgt || "(unspecified)"} · audience ${aud} · sections: ${sections.join(", ") || "summary only"}.`, checklist };
}

export async function buildReport(input: ReportInput): Promise<OpsReport> {
  const rt = String(input.reportType ?? "").toLowerCase().trim() || "custom";
  const title = String(input.title ?? "").trim() || `${rt} report`;
  const tgt = String(input.target ?? "").trim();
  const objective = String(input.objective ?? "").trim();
  const notes = String(input.notes ?? "").trim();
  const aud = REPORT_AUDIENCES.has(String(input.audience ?? "").toLowerCase()) ? String(input.audience).toLowerCase() : "internal";
  const isClient = aud === "client" || aud === "executive" || rt === "client_summary";
  const sc = (s: string) => reportScrub(s, isClient);

  const hits = await hazardLookup(tgt);
  const g = await groundedFor(tgt, rt === "deployment" ? "deploy" : rt === "incident" ? "restart" : undefined);
  const targetKnown = tgt.length > 0 && hits.matches.length > 0;

  // Evidence is grounded-doc-derived (real) or explicitly marked unavailable — never invented.
  const evidence: ReportEvidence[] = targetKnown
    ? hits.matches.slice(0, 8).map((m) => ({ type: "grounded-doc", title: sc(m.heading), summary: sc(m.snippet), source: m.doc }))
    : [{ type: "unavailable", title: "No grounded evidence for target", summary: `Target "${tgt || "(unspecified)"}" was not found in the ecosystem docs. Gather read-only evidence before relying on this report — do not assume.` }];

  const knownHaz = input.includeHazards !== false ? [...knownHazardWarnings(rt === "deployment" ? "deploy" : rt, tgt), ...g.hazards].map(sc) : [];

  const opsState = opsStatus();
  const diagnosticsSummary = input.includeDiagnostics === false
    ? "(diagnostics section omitted)"
    : opsState.status === "local"
      ? `Ops diagnostics enabled (${opsState.allowedCount} allowlisted check(s)). Run ops.health / ops.verify.* for live read-only evidence.`
      : "Live diagnostics UNAVAILABLE — ops provider is disabled by default. Enable read-only checks to populate (no data was invented).";

  const verificationSummary = input.includeVerification === false
    ? "(verification section omitted)"
    : "Read-only verification is available via ops.verify.* — run AFTER the action; results are not yet collected, so mark pass/fail with evidence. Nothing here was verified by changing it.";

  const actionsTakenOrPlanned = input.includeRunbook === false ? [] : [
    objective ? `Objective: ${sc(objective)}` : "Objective: (not provided)",
    "Dry-run plans (ops.*.plan) and a HUMAN-ONLY runbook (ops.runbook.generate) can be produced under approval — MigraPilot executes no infrastructure action.",
    notes ? `Operator notes: ${sc(notes)}` : "No operator notes provided.",
  ];

  const timeline = input.includeTimeline === false ? [] : [
    `${nowIso()} — report generated (status: draft, read-only).`,
    "(timeline to be populated by the operator with actual action/verification timestamps)",
  ];

  return {
    reportId: reportId(),
    reportType: rt,
    title,
    target: tgt || "(unspecified)",
    audience: aud,
    status: "draft",
    generatedAt: nowIso(),
    executiveSummary: sc(`READ-ONLY DRAFT — ${title}. ${objective || `Ops evidence report for ${tgt || "(unspecified)"}.`} Compiled from grounded ecosystem documentation and provided inputs; no action was executed and no system was changed.${isClient ? " (Audience: " + aud + " — internal detail redacted.)" : ""}`),
    scope: sc(`${rt} report for ${tgt || "(unspecified)"}, audience ${aud}.`),
    evidence,
    diagnosticsSummary: sc(diagnosticsSummary),
    hazards: knownHaz,
    actionsTakenOrPlanned,
    verificationSummary,
    timeline,
    recommendations: [
      "Treat grounded-doc evidence as authoritative; treat anything marked unavailable/unknown as TODO, not fact.",
      targetKnown ? "Follow the documented safe procedure and hazards for this target before acting." : "Establish the real target/source/procedure from trusted docs before acting.",
      "Use dry-run plans + the human-only runbook (approval-gated) for any change; verify with read-only checks afterward.",
    ],
    limitations: [
      "Compiled from grounded ecosystem docs + provided inputs; contains NO live system data unless the ops provider is configured.",
      "Read-only: no command was executed, no file was written, and no external system was changed.",
      isClient ? "Client/executive view — internal infrastructure detail is intentionally redacted." : "Internal/technical view — includes infrastructure detail; do not share externally.",
    ],
    nextSteps: [
      objective ? "Confirm the objective's prerequisites (read-only) before any action." : "Define the objective and target precisely.",
      "Generate the dry-run plan + runbook (approval-gated) and collect verification evidence after the human acts.",
    ],
    citations: g.citations.length ? g.citations : ["(target not found in ecosystem docs — verify before relying on this report)"],
  };
}

// ---- Health re-check bundles (Phase 10.9) — READ-ONLY, composes existing read checks ----
export interface BundleCheck {
  type: string;
  name: string;
  status: VerifyStatus;
  evidence: string;
  latencyMs?: number;
  sanitizedUrl?: string;
}
export interface HealthBundle {
  bundleId: string;
  target: string;
  serviceName?: string;
  status: VerifyStatus;
  generatedAt: string;
  checks: BundleCheck[];
  hazards: string[];
  topologySummary: string;
  verificationSummary: string;
  reportSummary?: string;
  recommendations: string[];
  nextReadOnlyChecks: string[];
  limitations: string[];
  citations: string[];
}
export interface HealthBundleInput {
  target: string;
  serviceName?: string;
  healthUrls?: string[];
  expectedText?: string;
  expectedBuildId?: string;
  includeHazards?: boolean;
  includeTopology?: boolean;
  includeReportSummary?: boolean;
  audience?: string;
}

let bundleCounter = 0;
function bundleId(): string {
  bundleCounter += 1;
  return `hb_${Date.now().toString(36)}_${bundleCounter.toString(36)}`;
}

export function previewHealthBundle(input: HealthBundleInput): { valid: boolean; target: string; serviceName?: string; plannedChecks: string[]; allowlistedUrlCount: number; clientSafe: boolean; summary: string; note: string } {
  const target = String(input.target ?? "").trim();
  const aud = REPORT_AUDIENCES.has(String(input.audience ?? "").toLowerCase()) ? String(input.audience).toLowerCase() : "internal";
  const isClient = aud === "client" || aud === "executive";
  const urls = Array.isArray(input.healthUrls) ? input.healthUrls.filter((u) => typeof u === "string" && u.trim()) : [];
  const planned: string[] = [];
  if (urls.length) planned.push(`${urls.length} allowlisted URL health check(s) (GET, sanitized, no body returned)`);
  else planned.push("no health URLs provided — URL checks will be skipped/unknown");
  if (input.expectedText) planned.push("expected-text match (internal only — body never exposed)");
  if (input.expectedBuildId) planned.push("expected-build-id match (internal only — body never exposed)");
  if (input.includeHazards !== false) planned.push("grounded hazard lookup for target");
  if (input.includeTopology !== false) planned.push("grounded topology summary for target");
  if (input.includeReportSummary) planned.push(`report-style summary (audience ${aud}${isClient ? ", internal detail redacted" : ""})`);
  planned.push("grounded-knowledge presence check");
  return { valid: true, target: target || "(unspecified)", serviceName: input.serviceName ? String(input.serviceName).trim() : undefined, plannedChecks: planned, allowlistedUrlCount: urls.length, clientSafe: isClient, summary: `Preview: health re-check bundle for ${target || "(unspecified)"} — ${planned.length} planned read-only check(s).`, note: "PREVIEW ONLY — no checks are executed here; run the bundle to gather evidence. Nothing is ever mutated." };
}

export async function buildHealthBundle(input: HealthBundleInput): Promise<HealthBundle> {
  const target = String(input.target ?? "").trim();
  const serviceName = input.serviceName ? String(input.serviceName).trim() : undefined;
  const aud = REPORT_AUDIENCES.has(String(input.audience ?? "").toLowerCase()) ? String(input.audience).toLowerCase() : "internal";
  const isClient = aud === "client" || aud === "executive";
  const sc = (s: string) => reportScrub(s, isClient);
  const urls = (Array.isArray(input.healthUrls) ? input.healthUrls : []).filter((u) => typeof u === "string" && u.trim()).slice(0, 20);

  const checks: BundleCheck[] = [];

  // 1. Allowlisted URL health (sanitized; never returns body)
  for (const u of urls) {
    const c = await checkUrl(u);
    const st: VerifyStatus = c.ok ? "pass" : c.error && (c.error.includes("disabled") || c.error.includes("allowlist")) ? "unknown" : "fail";
    checks.push({ type: "url-health", name: c.url, status: st, evidence: c.ok ? `HTTP ${c.status} in ${c.latencyMs}ms` : c.error ?? "failed", latencyMs: c.latencyMs, sanitizedUrl: c.url });
  }

  // 2. expectedText / expectedBuildId — matched INTERNALLY against the first allowlisted URL; body never exposed
  if ((input.expectedText || input.expectedBuildId) && urls.length) {
    const ev = await fetchEvidence(urls[0]);
    if (input.expectedText) {
      const found = !!ev.body && ev.body.includes(input.expectedText);
      checks.push({ type: "expected-text", name: "expected text", status: ev.body ? (found ? "pass" : "fail") : "unknown", evidence: ev.body ? (found ? "expected text present in response" : "expected text NOT found") : ev.error ?? "no response body to match", sanitizedUrl: ev.url });
    }
    if (input.expectedBuildId) {
      const found = !!ev.body && ev.body.includes(input.expectedBuildId);
      checks.push({ type: "expected-build-id", name: "expected build id", status: ev.body ? (found ? "pass" : "fail") : "unknown", evidence: ev.body ? (found ? "expected build id present" : "expected build id NOT found") : ev.error ?? "no response body to match", sanitizedUrl: ev.url });
    }
  } else if (input.expectedText || input.expectedBuildId) {
    checks.push({ type: "expected-text", name: "expected text/build id", status: "unknown", evidence: "no allowlisted health URL provided to match against" });
  }

  // 3. Grounded knowledge
  const hits = await hazardLookup(target);
  const g = await groundedFor(target);
  const targetKnown = target.length > 0 && hits.matches.length > 0;
  checks.push({ type: "grounded-knowledge", name: "ecosystem docs", status: targetKnown ? "pass" : "unknown", evidence: targetKnown ? `${hits.matches.length} grounded reference(s) for ${target}` : "target not found in ecosystem docs" });

  const hazards = input.includeHazards !== false ? [...knownHazardWarnings("verify", target), ...g.hazards].map(sc) : [];

  let topologySummary = "(topology omitted)";
  if (input.includeTopology !== false) {
    const topoHits = hits.matches.filter((m) => m.doc.toLowerCase().includes("topology"));
    topologySummary = targetKnown
      ? sc(topoHits.length ? `Grounded topology references: ${topoHits.map((m) => m.heading).join("; ")}` : "Grounded references found (no topology-specific section)")
      : "Topology not found for target — verify before relying on this.";
  }

  // Overall status from the evidence-bearing checks (URL + expected matches)
  const evChecks = checks.filter((c) => c.type === "url-health" || c.type === "expected-text" || c.type === "expected-build-id").map((c) => c.status);
  const status: VerifyStatus = evChecks.length === 0 ? "unknown" : evChecks.every((s) => s === "pass") ? "pass" : evChecks.some((s) => s === "fail") ? "fail" : evChecks.some((s) => s === "pass") ? "partial" : "unknown";

  const okUrls = checks.filter((c) => c.type === "url-health" && c.status === "pass").length;
  const verificationSummary = urls.length
    ? `${okUrls}/${urls.length} allowlisted health URL(s) OK. Read-only — verified by observation, nothing was changed.`
    : "No allowlisted health URL provided — set PILOT_OPS_ALLOWED_HEALTH_URLS entries for live evidence (currently unknown).";

  let reportSummary: string | undefined;
  if (input.includeReportSummary) {
    const r = await buildReport({ reportType: "verification", title: `Health re-check: ${target || "(unspecified)"}`, target, audience: aud, objective: `Post-change health re-check for ${serviceName || target || "the target"}` });
    reportSummary = r.executiveSummary;
  }

  return {
    bundleId: bundleId(),
    target: target || "(unspecified)",
    serviceName,
    status,
    generatedAt: nowIso(),
    checks,
    hazards,
    topologySummary,
    verificationSummary,
    reportSummary,
    recommendations: [
      status === "pass" ? "Checks look healthy from available evidence — still spot-check one real user request." : "Do not assume healthy — resolve the failing/unknown checks below first.",
      targetKnown ? "Mind the grounded hazards before any follow-up change." : "Confirm the real target/source from trusted docs.",
    ],
    nextReadOnlyChecks: [
      urls.length ? "Re-run after a short delay to confirm stability." : "Provide allowlisted health URL(s) for live evidence.",
      "Check logs for errors (read-only) and confirm dependent services still route correctly.",
    ],
    limitations: [
      "Read-only: composed of GET health checks + grounded docs only; no command executed, no file written, nothing mutated.",
      "Response bodies are NEVER returned — only match results and status codes are reported.",
      isClient ? "Client/executive view — internal infrastructure detail is redacted." : "Internal/technical view — includes infrastructure detail; do not share externally.",
    ],
    citations: g.citations.length ? g.citations : ["(target not found in ecosystem docs — verify before relying on this bundle)"],
  };
}

// ---- Controlled NO-OP ops actions (Phase 11.0, journal-backed Phase 11.2) — mutates NOTHING ----
export interface NoopExecuteInput {
  target: string;
  reason: string;
  expectedVerificationUrl?: string;
  metadata?: unknown;
  approvalId?: string;
  runId?: string;
}
export interface NoopVerifyResult {
  verificationType: "noop";
  target: string;
  recordId?: string;
  mutated: false;
  status: VerifyStatus;
  checks: BundleCheck[];
  summary: string;
  generatedAt: string;
}

// Records a controlled NO-OP via the action journal. Performs NO infrastructure mutation and calls
// NO external API. Exact-once is enforced upstream by the approval system (double approval → 409
// before this runs), so the journal never receives a duplicate create for one execution.
export async function executeNoop(input: NoopExecuteInput): Promise<ActionRecord> {
  const target = String(input.target ?? "").trim() || "(unspecified)";
  const reason = String(input.reason ?? "").trim() || "(none provided)";
  const metadata: Record<string, unknown> = { ...(input.metadata && typeof input.metadata === "object" ? (input.metadata as Record<string, unknown>) : {}) };
  if (input.expectedVerificationUrl) metadata.verificationUrl = sanitizeUrl(input.expectedVerificationUrl);
  return createActionRecord({
    actionName: "ops.noop.execute",
    category: "noop",
    executionMode: "noop",
    target,
    reason,
    mutated: false,
    dryRun: false,
    executed: true,
    status: "recorded",
    approvalId: input.approvalId,
    runId: input.runId,
    metadata,
    summary: `Controlled NO-OP recorded for "${target}". NO external system was changed, no command ran, no API was called — this proves the approval/audit/exact-once rails only.`,
  });
}

// Read-only: confirms a no-op record exists (from the journal) and optionally runs ONE allowlisted health check.
export async function verifyNoop(input: { target: string; healthUrl?: string }): Promise<NoopVerifyResult> {
  const target = String(input.target ?? "").trim();
  const recent = await listRecentActionRecords(100);
  const rec = (target ? recent.find((r) => r.target === target && r.actionName === "ops.noop.execute") : undefined) ?? recent.find((r) => r.actionName === "ops.noop.execute");
  const checks: BundleCheck[] = [{
    type: "noop-record",
    name: "controlled no-op record",
    status: rec ? "pass" : "unknown",
    evidence: rec ? `record ${rec.id} found — executed:${rec.executed}, mutated:${rec.mutated}, dryRun:${rec.dryRun}` : "no no-op record found for target",
  }];
  if (input.healthUrl) {
    const c = await checkUrl(input.healthUrl);
    checks.push({ type: "health-url", name: "allowlisted health check", status: c.ok ? "pass" : c.error && (c.error.includes("disabled") || c.error.includes("allowlist")) ? "unknown" : "fail", evidence: c.ok ? `HTTP ${c.status} in ${c.latencyMs}ms` : c.error ?? "failed", latencyMs: c.latencyMs, sanitizedUrl: c.url });
  }
  const evStatuses = checks.map((c) => c.status);
  const status: VerifyStatus = evStatuses.every((s) => s === "pass") ? "pass" : evStatuses.some((s) => s === "fail") ? "fail" : evStatuses.some((s) => s === "pass") ? "partial" : "unknown";
  return {
    verificationType: "noop",
    target: target || "(unspecified)",
    recordId: rec?.id,
    mutated: false,
    status,
    checks,
    summary: rec ? `No-op record verified (mutated:false). ${input.healthUrl ? "Health check included." : "No health URL provided."}` : "No matching no-op record found — nothing was executed for this target.",
    generatedAt: nowIso(),
  };
}

export interface HazardMatch {
  doc: string;
  heading: string;
  snippet: string;
}
export async function hazardLookup(query: string): Promise<{ query: string; matches: HazardMatch[]; detail: string }> {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return { query: "", matches: [], detail: "provide a service/app/server name to look up" };
  let files: string[] = [];
  try {
    files = (await readdir(ECO_DIR)).filter((f) => f.endsWith(".md"));
  } catch {
    return { query, matches: [], detail: "ecosystem docs not found — ingest the Phase 10.2 pack first" };
  }
  const matches: HazardMatch[] = [];
  for (const f of files) {
    const content = await readEcoDoc(f);
    if (!content) continue;
    // Split into heading-delimited sections; return sections that mention the query.
    const sections = content.split(/\n(?=#{1,4}\s)/);
    for (const sec of sections) {
      if (sec.toLowerCase().includes(q)) {
        const heading = (sec.match(/^#{1,4}\s+(.+)$/m)?.[1] ?? "(section)").trim();
        matches.push({ doc: f, heading, snippet: sec.replace(/\s+/g, " ").trim().slice(0, 400) });
        if (matches.length >= 12) break;
      }
    }
    if (matches.length >= 12) break;
  }
  return { query, matches, detail: matches.length ? `${matches.length} grounded match(es)` : "no grounded match in ecosystem docs" };
}
