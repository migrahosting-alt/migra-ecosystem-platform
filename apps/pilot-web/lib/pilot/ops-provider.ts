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
