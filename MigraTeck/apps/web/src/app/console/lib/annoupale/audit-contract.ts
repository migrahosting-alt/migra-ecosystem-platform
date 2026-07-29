import { z } from "zod";

/**
 * Contract gate for the AnnouPale audit log (GET /api/admin/audit-logs).
 *
 * PURE module (no server-only / next imports) so it is unit-testable.
 *
 * PII / safety: the raw audit row carries `ipHash` and a free-form `metadata`
 * object. This mapper deliberately DROPS both — only the action verb, actor
 * role, target type/id, and timestamp are surfaced. The hashed IP and arbitrary
 * metadata are never rendered.
 */

const RawItem = z
  .object({
    id: z.string(),
    actorUserId: z.string().nullish(),
    actorRole: z.string().nullish(),
    actionType: z.string().nullish(),
    targetType: z.string().nullish(),
    targetId: z.string().nullish(),
    createdAt: z.string().nullish(),
  })
  .passthrough(); // ignore ipHash / metadata / requestId rather than fail

const RawEnvelope = z.object({
  items: z.array(RawItem),
  nextCursor: z.string().nullish(),
  hasMore: z.boolean().nullish(),
});

export type AuditEventRow = {
  id: string;
  actor: string;
  actionType: string;
  targetType: string;
  /** Display-truncated target id (e.g. "abcdef12…"). Never the full id for non-cases. */
  targetId: string;
  /**
   * Full target id, populated ONLY when the target is a compliance case (an
   * opaque case id — not PII), so the UI can deep-link to the case detail.
   * Empty for every other target type to avoid surfacing fuller user ids.
   */
  targetRef: string;
  createdAt: string;
};

export type AuditLogData = {
  items: AuditEventRow[];
  hasMore: boolean;
};

export type AuditParseResult =
  | { ok: true; data: AuditLogData }
  | { ok: false };

const DASH = "—";
const s = (v: unknown): string => (typeof v === "string" && v.length ? v : "");

/** Short, non-identifying actor label: role if present, else a short id, else system. */
function actorLabel(c: z.infer<typeof RawItem>): string {
  const role = s(c.actorRole);
  if (role) return role;
  const id = s(c.actorUserId);
  if (id) return `${id.slice(0, 8)}…`;
  return "system";
}

function mapRow(c: z.infer<typeof RawItem>): AuditEventRow {
  const tid = s(c.targetId);
  const targetType = s(c.targetType);
  const isCase = isComplianceCaseTarget(targetType);
  return {
    id: c.id,
    actor: actorLabel(c),
    actionType: s(c.actionType) || DASH,
    targetType: targetType || DASH,
    targetId: tid ? `${tid.slice(0, 8)}…` : "",
    // Full id retained only for compliance-case deep-links (case id is opaque,
    // not PII); other target ids stay truncated-only.
    targetRef: isCase ? tid : "",
    createdAt: s(c.createdAt),
  };
}

/* ----------------------------- safe filtering ----------------------------- */

/**
 * Action-type filter options for the audit log. "all" plus the staff actions
 * the Trust & Operations console surfaces. Selecting one filters the already-
 * loaded safe window client-side — no new query is sent to the backend, so no
 * filtered total is ever fabricated.
 */
export const AUDIT_ACTION_FILTERS = [
  { value: "all", label: "All actions" },
  { value: "staff_token_exchange", label: "Staff token exchange" },
  { value: "compliance.case.note_added", label: "Case note added" },
  { value: "compliance.case.updated", label: "Case updated" },
  { value: "compliance.case.closed", label: "Case closed" },
  { value: "auth.session.refreshed", label: "Session refreshed" },
] as const;

export type AuditActionFilter = (typeof AUDIT_ACTION_FILTERS)[number]["value"];

/** True when an audit target is a compliance case (safe to deep-link). */
export function isComplianceCaseTarget(targetType: string): boolean {
  const t = (targetType || "").toLowerCase().replace(/[^a-z]/g, "");
  return t === "compliancecase" || t === "case";
}

/** Console deep-link for a compliance case target, or null when unavailable. */
export function complianceCaseHref(targetRef: string): string | null {
  return targetRef ? `/console/annoupale/compliance/${encodeURIComponent(targetRef)}` : null;
}

export type AuditFilter = {
  action?: string | undefined;
  actor?: string | undefined;
  /** free-text, matched against target type + (redacted) id, case-insensitive */
  target?: string | undefined;
};

/**
 * Filters a window of already-safe audit rows. Pure + order-preserving. Used to
 * narrow the loaded window only — counts shown by callers are "within the loaded
 * window", never a fabricated backend total.
 */
export function filterAuditEvents(items: AuditEventRow[], f: AuditFilter): AuditEventRow[] {
  const action = f.action && f.action !== "all" ? f.action : undefined;
  const actor = f.actor && f.actor !== "all" ? f.actor : undefined;
  const target = f.target ? f.target.trim().toLowerCase() : "";
  return items.filter((e) => {
    if (action && e.actionType !== action) return false;
    if (actor && e.actor !== actor) return false;
    if (target) {
      const hay = `${e.targetType} ${e.targetId} ${e.targetRef}`.toLowerCase();
      if (!hay.includes(target)) return false;
    }
    return true;
  });
}

/** Distinct, already-redacted actor labels present in the window (sorted). */
export function distinctActors(items: AuditEventRow[]): string[] {
  return Array.from(new Set(items.map((e) => e.actor).filter(Boolean))).sort();
}

export function parseAuditEnvelope(json: unknown): AuditParseResult {
  const parsed = RawEnvelope.safeParse(json);
  if (!parsed.success) return { ok: false };
  return {
    ok: true,
    data: {
      items: parsed.data.items.map(mapRow),
      hasMore: parsed.data.hasMore === true,
    },
  };
}
