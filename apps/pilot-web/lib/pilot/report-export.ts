// MigraPilot — safe-read report EXPORT PREVIEW (Phase 12.10).
//
// PREVIEW-ONLY. Renders an existing safe-read report payload into a copy-safe export string
// (markdown | json | text) through the SAME redaction path as safe-read responses
// (`redactPilotValue`, Phase 12.7). It writes NO file, executes nothing, enables no action, and
// changes no eligibility/approval/hash logic. If any secret survives redaction (post-scan), it
// FAILS CLOSED: no content is returned.

import { redactPilotValue, isSensitiveKey } from "./redaction";

export type ReportExportFormat = "markdown" | "json" | "text";

export interface ReportExportInput {
  report: unknown;            // any safe-read report payload (e.g. output of ops.report.generate)
  format?: ReportExportFormat;
  title?: string;
}

export interface ReportExportRedactionSummary {
  redactionHelper: "lib/pilot/redaction.ts";
  sensitiveFieldsRemoved: number;
  // NOTE: field names intentionally avoid the substrings "credential"/"secret" so they are not
  // themselves redacted when the whole preview passes through redactPilotValue (defense-in-depth).
  urlCredsRedacted: number;
  riskPatternsDetected: number;
  unsafeOutputBlocked: boolean;
}

export interface ReportExportPreview {
  exportId: string;
  format: ReportExportFormat;
  title: string;
  generatedAt: string;
  copySafe: boolean;
  executed: false;
  written: false;
  eligibleForExecution: false;
  redactions: ReportExportRedactionSummary;
  content: string;            // redacted; empty string when blocked
  blockedReason?: string;
}

const FORMATS: ReadonlySet<string> = new Set(["markdown", "json", "text"]);

// Count (never emit) sensitive keys + secret patterns in the ORIGINAL input — for the summary.
const URL_CRED_RE = /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqps?):\/\/[^/@\s'"]*:[^/@\s'"]*@/gi;
const SECRET_PAT_RE = /(?:-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/\-]{6,}|\bBasic\s+[A-Za-z0-9+/]{6,}={0,2}|\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{4,})/g;

function countStats(input: unknown, acc: { fields: number; urls: number; secrets: number }, seen: WeakSet<object>): void {
  if (input === null || input === undefined) return;
  if (typeof input === "string") {
    acc.urls += (input.match(URL_CRED_RE) || []).length;
    acc.secrets += (input.match(SECRET_PAT_RE) || []).length;
    return;
  }
  if (typeof input !== "object") return;
  if (seen.has(input as object)) return;
  seen.add(input as object);
  if (Array.isArray(input)) { for (const v of input) countStats(v, acc, seen); return; }
  for (const k of Object.keys(input as Record<string, unknown>)) {
    if (isSensitiveKey(k)) acc.fields++;
    else countStats((input as Record<string, unknown>)[k], acc, seen);
  }
}

// Post-redaction scan: real secrets only — placeholders like [REDACTED] must NOT trip these.
const POST_URL_RE = /:\/\/[^:/@\s'"]+:[^/@\s'"]+@/;            // scheme://user:pass@ (inner colon)
const POST_SECRET_RE = /(?:-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----|\bBearer\s+(?!\[REDACTED\])[A-Za-z0-9._~+/\-]{6,}|\bBasic\s+(?!\[REDACTED\])[A-Za-z0-9+/]{6,}={0,2}|\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{4,})/;

function toMarkdown(value: unknown, title: string): string {
  const lines: string[] = [`# ${title}`, ""];
  const render = (v: unknown, depth: number) => {
    const h = "#".repeat(Math.min(depth + 1, 6));
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (val && typeof val === "object") { lines.push(`${h} ${k}`, ""); render(val, depth + 1); }
        else lines.push(`- **${k}:** ${String(val)}`);
      }
      lines.push("");
    } else if (Array.isArray(v)) {
      lines.push("```json", JSON.stringify(v, null, 2), "```", "");
    } else {
      lines.push(String(v), "");
    }
  };
  render(value, 1);
  return lines.join("\n").trim() + "\n";
}

function flatten(value: unknown, prefix = ""): string[] {
  if (value === null || value === undefined) return [`${prefix}: ${value}`];
  if (typeof value !== "object") return [`${prefix}: ${String(value)}`];
  const out: string[] = [];
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value as Record<string, unknown>);
  for (const [k, v] of entries) out.push(...flatten(v, prefix ? `${prefix}.${k}` : k));
  return out;
}

function hashId(seed: string): string {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) + h + seed.charCodeAt(i)) >>> 0;
  return "exp_" + h.toString(36);
}

export function buildReportExportPreview(input: ReportExportInput, nowIso: string): ReportExportPreview {
  const format = (FORMATS.has(String(input.format)) ? input.format : "markdown") as ReportExportFormat;
  const rawTitle = (typeof input.title === "string" && input.title.trim()) ? input.title.trim() : "MigraPilot Safe-Read Report";
  const title = String(redactPilotValue(rawTitle)); // redact secret patterns in the title too

  const acc = { fields: 0, urls: 0, secrets: 0 };
  countStats(input.report, acc, new WeakSet());

  const redacted = redactPilotValue(input.report);
  let content =
    format === "json" ? JSON.stringify(redacted, null, 2)
    : format === "text" ? flatten(redacted).join("\n")
    : toMarkdown(redacted, title);

  // Fail closed: if any real secret survived redaction, block content entirely.
  const residual = POST_URL_RE.test(content) || POST_SECRET_RE.test(content);
  const base: Omit<ReportExportPreview, "content" | "copySafe" | "blockedReason"> = {
    exportId: hashId(`${title}|${format}|${nowIso}`),
    format, title, generatedAt: nowIso,
    executed: false, written: false, eligibleForExecution: false,
    redactions: { redactionHelper: "lib/pilot/redaction.ts", sensitiveFieldsRemoved: acc.fields, urlCredsRedacted: acc.urls, riskPatternsDetected: acc.secrets, unsafeOutputBlocked: residual },
  };
  if (residual) {
    return { ...base, content: "", copySafe: false, blockedReason: "redaction_incomplete: a secret pattern survived redaction; export blocked (fail closed)" };
  }
  return { ...base, content, copySafe: true };
}
