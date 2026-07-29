import { z } from "zod";

/**
 * Contract gate for a single AnnouPale compliance case
 * (GET /api/admin/compliance/cases/:id — returns the full case record).
 *
 * PURE module (no server-only / next imports) so it is unit-testable. It parses
 * defensively and maps to a staff-facing detail view.
 *
 * PII NOTE: unlike the queue LIST (which drops requester PII), the staff case
 * DETAIL view legitimately shows requester fields — they are required to triage
 * a case and are only ever reachable server-side behind the per-user staff
 * bridge (never rendered in the list, never sent a token to the browser).
 */

const Raw = z
  .object({
    id: z.string(),
    publicCaseId: z.string().nullish(),
    category: z.string().nullish(),
    requestType: z.string().nullish(),
    priority: z.string().nullish(),
    severity: z.string().nullish(),
    status: z.string().nullish(),
    sourceRoute: z.string().nullish(),
    requesterName: z.string().nullish(),
    requesterEmail: z.string().nullish(),
    requesterHandle: z.string().nullish(),
    requesterUserId: z.string().nullish(),
    targetUserHandle: z.string().nullish(),
    targetUrl: z.string().nullish(),
    details: z.string().nullish(),
    assignedTo: z.string().nullish(),
    actionTaken: z.string().nullish(),
    internalNotes: z.string().nullish(),
    metadata: z.record(z.string(), z.unknown()).nullish(),
    createdAt: z.string().nullish(),
    updatedAt: z.string().nullish(),
    closedAt: z.string().nullish(),
  })
  .passthrough();

export type RiskFlags = {
  childSafety: boolean;
  underage: boolean;
  immediateDanger: boolean;
  attorneyReviewRequired: boolean;
  securityIssue: boolean;
};

export type MetadataEntry = { key: string; value: string };

export type ComplianceCaseDetail = {
  id: string;
  caseId: string;
  category: string;
  requestType: string;
  priority: string;
  severity: string;
  status: string;
  sourceRoute: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string;
  riskFlags: RiskFlags;
  requester: { name: string; email: string; handle: string; userId: string };
  target: { handle: string; url: string };
  details: string;
  internal: { assignedTo: string; actionTaken: string; internalNotes: string };
  metadata: MetadataEntry[];
};

export type DetailParseResult =
  | { ok: true; detail: ComplianceCaseDetail }
  | { ok: false };

const DASH = "—";
const s = (v: unknown): string => (typeof v === "string" && v.length ? v : "");
const dash = (v: unknown): string => s(v) || DASH;

// metadata keys already surfaced elsewhere (as flags) — hidden from the raw dump.
const SURFACED_META = new Set(["urgency", "attorneyReviewRequired"]);

function deriveRiskFlags(c: z.infer<typeof Raw>): RiskFlags {
  const meta = c.metadata ?? {};
  const requestType = s(c.requestType);
  return {
    childSafety: requestType === "child_safety",
    underage: requestType === "underage",
    immediateDanger: meta["urgency"] === "immediate_danger",
    attorneyReviewRequired: meta["attorneyReviewRequired"] === true,
    securityIssue: s(c.category) === "security",
  };
}

function safeMetadata(meta: Record<string, unknown> | null | undefined): MetadataEntry[] {
  if (!meta || typeof meta !== "object") return [];
  const out: MetadataEntry[] = [];
  for (const [key, value] of Object.entries(meta)) {
    if (SURFACED_META.has(key)) continue;
    if (value === null || value === undefined) continue;
    // Only primitive values are rendered (as text). Objects/arrays are skipped
    // to avoid dumping nested structures / accidental unsafe content.
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      out.push({ key, value: String(value) });
    }
  }
  return out;
}

export function parseComplianceCaseDetail(json: unknown): DetailParseResult {
  const parsed = Raw.safeParse(json);
  if (!parsed.success) return { ok: false };
  const c = parsed.data;
  return {
    ok: true,
    detail: {
      id: c.id,
      caseId: s(c.publicCaseId) || c.id,
      category: dash(c.category),
      requestType: dash(c.requestType),
      priority: dash(c.priority),
      severity: dash(c.severity),
      status: dash(c.status),
      sourceRoute: dash(c.sourceRoute),
      createdAt: s(c.createdAt),
      updatedAt: s(c.updatedAt),
      closedAt: s(c.closedAt),
      riskFlags: deriveRiskFlags(c),
      requester: {
        name: dash(c.requesterName),
        email: dash(c.requesterEmail),
        handle: dash(c.requesterHandle),
        userId: dash(c.requesterUserId),
      },
      target: { handle: dash(c.targetUserHandle), url: s(c.targetUrl) },
      details: s(c.details),
      internal: {
        assignedTo: dash(c.assignedTo),
        actionTaken: dash(c.actionTaken),
        internalNotes: s(c.internalNotes),
      },
      metadata: safeMetadata(c.metadata),
    },
  };
}

/* ------------------------------ case timeline ----------------------------- */

export type CaseTimelineKind = "created" | "note" | "updated" | "closed";

export type CaseTimelineEntry = {
  kind: CaseTimelineKind;
  label: string;
  /** ISO timestamp, or "" when the case record carries no precise time for it. */
  at: string;
};

/**
 * Derives a lifecycle timeline from the case record's own fields ONLY — no audit
 * events are fabricated. Entries with no precise timestamp on the record (e.g.
 * "internal notes recorded", which is a single text blob with no per-note time)
 * are emitted with `at: ""` so the UI can show them honestly and point staff to
 * the full audit log for exact times. Returns entries in lifecycle order.
 */
export function deriveCaseTimeline(
  d: Pick<ComplianceCaseDetail, "createdAt" | "updatedAt" | "closedAt" | "internal">,
): CaseTimelineEntry[] {
  const out: CaseTimelineEntry[] = [];
  if (d.createdAt) out.push({ kind: "created", label: "Case created", at: d.createdAt });
  if (d.internal?.internalNotes && d.internal.internalNotes.trim().length > 0) {
    out.push({ kind: "note", label: "Internal notes recorded", at: "" });
  }
  if (d.updatedAt && d.updatedAt !== d.createdAt) {
    out.push({ kind: "updated", label: "Last updated", at: d.updatedAt });
  }
  if (d.closedAt) out.push({ kind: "closed", label: "Case closed", at: d.closedAt });
  return out;
}

export const RISK_FLAG_LABELS: Array<{ key: keyof RiskFlags; label: string }> = [
  { key: "childSafety", label: "Child safety" },
  { key: "underage", label: "Underage" },
  { key: "immediateDanger", label: "Immediate danger" },
  { key: "attorneyReviewRequired", label: "Attorney review required" },
  { key: "securityIssue", label: "Security issue" },
];
