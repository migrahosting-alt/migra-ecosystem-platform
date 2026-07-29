import { z } from "zod";

/**
 * Contract gate for the AnnouPale moderation queue (GET /api/moderation/cases).
 *
 * PURE module (no server-only / next imports) so it is unit-testable. The
 * moderation list endpoint is cursor-paginated and does NOT return summary
 * counts, so we derive customer-/staff-safe rollups here from the returned page.
 *
 * Moderation cases reference an internal targetId (a user/content UUID), NOT
 * requester PII (no email/handle), so the whole row is safe to render to the
 * authenticated staff operator.
 */

const RawCase = z
  .object({
    id: z.string(),
    caseType: z.string().nullish(),
    targetType: z.string().nullish(),
    targetId: z.string().nullish(),
    status: z.string().nullish(),
    priority: z.string().nullish(),
    assignedTo: z.string().nullish(),
    riskScore: z.number().nullish(),
    openedAt: z.string().nullish(),
    closedAt: z.string().nullish(),
  })
  .passthrough();

const RawEnvelope = z.object({
  cases: z.array(RawCase),
  nextCursor: z.string().nullish(),
  hasMore: z.boolean().nullish(),
});

export type ModerationCaseRow = {
  id: string;
  caseType: string;
  targetType: string;
  targetId: string;
  status: string;
  priority: string;
  assignedTo: string;
  riskScore: number;
  openedAt: string;
  closedAt: string;
};

export type ModerationSummary = {
  /** open + assigned = still needs work */
  pending: number;
  highPriority: number;
  total: number;
};

export type ModerationQueueData = {
  cases: ModerationCaseRow[];
  summary: ModerationSummary;
  hasMore: boolean;
};

export type ModerationParseResult =
  | { ok: true; data: ModerationQueueData }
  | { ok: false };

const DASH = "—";
const s = (v: unknown): string => (typeof v === "string" && v.length ? v : "");

function mapRow(c: z.infer<typeof RawCase>): ModerationCaseRow {
  return {
    id: c.id,
    caseType: s(c.caseType) || DASH,
    targetType: s(c.targetType) || DASH,
    targetId: s(c.targetId),
    status: s(c.status) || DASH,
    priority: s(c.priority) || DASH,
    assignedTo: s(c.assignedTo),
    riskScore: typeof c.riskScore === "number" ? c.riskScore : 0,
    openedAt: s(c.openedAt),
    closedAt: s(c.closedAt),
  };
}

const PENDING_STATUSES = new Set(["open", "assigned"]);
const HIGH_PRIORITIES = new Set(["high", "critical"]);

export function parseModerationEnvelope(json: unknown): ModerationParseResult {
  const parsed = RawEnvelope.safeParse(json);
  if (!parsed.success) return { ok: false };
  const cases = parsed.data.cases.map(mapRow);
  const pending = cases.filter((c) => PENDING_STATUSES.has(c.status)).length;
  const highPriority = cases.filter((c) => HIGH_PRIORITIES.has(c.priority)).length;
  return {
    ok: true,
    data: {
      cases,
      summary: { pending, highPriority, total: cases.length },
      hasMore: parsed.data.hasMore === true,
    },
  };
}

export const MODERATION_STATUS_OPTIONS = [
  "open",
  "assigned",
  "actioned",
  "closed",
] as const;
export const MODERATION_PRIORITY_OPTIONS = [
  "low",
  "normal",
  "high",
  "critical",
] as const;

export function sanitizeModerationStatus(v: string | undefined): string | undefined {
  return v && (MODERATION_STATUS_OPTIONS as readonly string[]).includes(v)
    ? v
    : undefined;
}
