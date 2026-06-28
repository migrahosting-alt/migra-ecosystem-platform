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
