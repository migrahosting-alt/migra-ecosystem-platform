import { z } from "zod";

/**
 * Contract gate for the AnnouPale compliance queue (GET /api/admin/compliance/cases).
 *
 * PURE module (no server-only / next imports) so it is unit-testable. It defines
 * the response contract, parses defensively, and maps to a SAFE row shape.
 *
 * SECURITY: the AnnouPale list endpoint also returns `requesterEmail` and
 * `requesterHandle` (PII). This mapper deliberately DOES NOT copy those into the
 * rendered row — only non-sensitive triage metadata is surfaced in the queue.
 */

// Lenient case schema — tolerant of field evolution; we only require id.
const RawCase = z
  .object({
    id: z.string(),
    publicCaseId: z.string().nullish(),
    category: z.string().nullish(),
    requestType: z.string().nullish(),
    priority: z.string().nullish(),
    severity: z.string().nullish(),
    status: z.string().nullish(),
    assignedTo: z.string().nullish(),
    createdAt: z.string().nullish(),
  })
  .passthrough(); // ignore extra fields (incl. PII) rather than fail the gate

const RawSummary = z
  .object({
    open: z.number(),
    urgent: z.number(),
    high: z.number(),
    waiting: z.number(),
    closed: z.number(),
  })
  .partial();

const RawEnvelope = z.object({
  cases: z.array(RawCase),
  total: z.number().nullish(),
  page: z.number().nullish(),
  limit: z.number().nullish(),
  summary: RawSummary.nullish(),
});

/** Safe, render-ready row — NO requester PII, NO free-text details. */
export type ComplianceCaseRow = {
  id: string;
  caseId: string;
  category: string;
  requestType: string;
  priority: string;
  severity: string;
  status: string;
  assignedTo: string;
  createdAt: string;
};

export type ComplianceSummary = {
  open: number;
  urgent: number;
  high: number;
  waiting: number;
  closed: number;
};

export type ComplianceQueueData = {
  cases: ComplianceCaseRow[];
  total: number;
  page: number;
  limit: number;
  summary: ComplianceSummary;
};

export type ParseResult =
  | { ok: true; data: ComplianceQueueData }
  | { ok: false };

const DASH = "—";

function mapCaseRow(c: z.infer<typeof RawCase>): ComplianceCaseRow {
  // Whitelist mapping — only these fields are ever read out. Any PII on the
  // input object (requesterEmail/requesterHandle/etc.) is dropped here.
  return {
    id: c.id,
    caseId: c.publicCaseId || c.id,
    category: c.category || DASH,
    requestType: c.requestType || DASH,
    priority: c.priority || DASH,
    severity: c.severity || DASH,
    status: c.status || DASH,
    assignedTo: c.assignedTo || "",
    createdAt: c.createdAt || "",
  };
}

export function parseComplianceEnvelope(json: unknown): ParseResult {
  const parsed = RawEnvelope.safeParse(json);
  if (!parsed.success) return { ok: false };
  const d = parsed.data;
  const cases = d.cases.map(mapCaseRow);
  const s = d.summary ?? {};
  return {
    ok: true,
    data: {
      cases,
      total: d.total ?? cases.length,
      page: d.page ?? 1,
      limit: d.limit ?? 25,
      summary: {
        open: s.open ?? 0,
        urgent: s.urgent ?? 0,
        high: s.high ?? 0,
        waiting: s.waiting ?? 0,
        closed: s.closed ?? 0,
      },
    },
  };
}

// --- Filter whitelists (mirror AnnouPale listQuerySchema enums) ---
export const STATUS_OPTIONS = [
  "open",
  "verifying",
  "investigating",
  "waiting_on_user",
  "escalated",
  "actioned",
  "denied",
  "closed",
] as const;
export const CATEGORY_OPTIONS = [
  "privacy",
  "safety",
  "security",
  "ip",
  "appeal",
  "account_deletion",
] as const;
export const PRIORITY_OPTIONS = ["low", "normal", "high", "urgent"] as const;
export const SEVERITY_OPTIONS = ["high"] as const;

export function sanitizeSeverity(v: string | undefined): string | undefined {
  return v && (SEVERITY_OPTIONS as readonly string[]).includes(v) ? v : undefined;
}

/** Accept only a plain ISO calendar date (YYYY-MM-DD); anything else → undefined. */
export function sanitizeDate(v: string | undefined): string | undefined {
  if (!v) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
}

export function sanitizeStatus(v: string | undefined): string | undefined {
  return v && (STATUS_OPTIONS as readonly string[]).includes(v) ? v : undefined;
}
export function sanitizeCategory(v: string | undefined): string | undefined {
  return v && (CATEGORY_OPTIONS as readonly string[]).includes(v) ? v : undefined;
}
export function sanitizePriority(v: string | undefined): string | undefined {
  return v && (PRIORITY_OPTIONS as readonly string[]).includes(v) ? v : undefined;
}
export function sanitizePage(v: string | undefined): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/**
 * Sanitize a free-text search term for the queue (topbar search box). Strips
 * control characters, collapses whitespace, trims, and caps length. Returns
 * undefined for empty input so no `search` param is sent. The term is passed to
 * the AnnouPale list endpoint's `search` filter server-side; it is never used to
 * build markup.
 */
export function sanitizeSearch(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const cleaned = v
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * Heuristic: does a search term look like an exact case identifier (e.g.
 * "AP-SEC-001" or a UUID) rather than a requester name/handle/email? Used to
 * offer a direct "open case" deep-link from the queue. Conservative: rejects
 * anything with whitespace or "@", and requires a dash-delimited token. The
 * case detail page handles a not-found id gracefully, so a false positive is
 * harmless.
 */
export function isLikelyCaseId(q: string | undefined): boolean {
  const v = (q ?? "").trim();
  if (!v || /\s/.test(v) || v.includes("@")) return false;
  if (v.length < 5 || v.length > 64) return false;
  return /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/.test(v);
}

export type QueueFailureReason =
  | "no_session"
  | "missing_env"
  | "denied"
  | "rate_limited"
  | "bridge_unavailable"
  | "upstream_error"
  | "contract_mismatch";

/** Human-facing, non-leaky explanation for the fallback panel. */
export function reasonLabel(reason: QueueFailureReason): string {
  switch (reason) {
    case "denied":
      return "Your AnnouPale staff access was not accepted. Use the fallback link below.";
    case "rate_limited":
      return "Temporarily rate-limited. Try again shortly or use the fallback link.";
    case "contract_mismatch":
      return "The compliance service returned an unexpected response. Use the fallback link.";
    case "no_session":
    case "missing_env":
    case "bridge_unavailable":
    case "upstream_error":
    default:
      return "The native compliance connection is unavailable right now. Use the fallback link below.";
  }
}
