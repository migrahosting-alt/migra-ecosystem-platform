/**
 * Contract + validation for compliance status / close mutations
 * (PATCH /api/admin/compliance/cases/:id, body { status?, actionTaken? }).
 *
 * PURE module (no server-only / next imports) so it is unit-testable. Mirrors
 * the AnnouPale backend updateCaseSchema. SCOPE: status + close only — this
 * module never sends priority/assignment.
 */

export const RESOLUTION_MAX = 5000;

/** Full backend status enum. */
export const ALL_STATUSES = [
  "open",
  "verifying",
  "investigating",
  "waiting_on_user",
  "escalated",
  "actioned",
  "denied",
  "closed",
] as const;

/**
 * Statuses settable via the plain status selector. "closed" is deliberately
 * EXCLUDED — closing must go through the gated close flow (resolution +
 * confirmation), never a silent status flip.
 */
export const SETTABLE_STATUSES = ALL_STATUSES.filter(
  (s) => s !== "closed",
) as readonly string[];

export type StatusReason =
  | "invalid_status"
  | "resolution_required"
  | "resolution_too_long"
  | "not_confirmed"
  | "denied" // 401 / 403
  | "not_found" // 404
  | "rate_limited" // 429
  | "invalid" // 400
  | "no_session"
  | "unavailable"; // bridge / network / upstream

export type StatusResult = { ok: true } | { ok: false; reason: StatusReason };

export function isSettableStatus(v: unknown): v is string {
  return typeof v === "string" && SETTABLE_STATUSES.includes(v);
}

/** Validate a non-close status change. */
export function validateStatusChange(status: unknown): StatusResult {
  if (!isSettableStatus(status)) return { ok: false, reason: "invalid_status" };
  return { ok: true };
}

/** Validate a close: requires confirmation + non-empty resolution (≤max). */
export function validateClose(
  resolutionRaw: unknown,
  confirmed: boolean,
): { ok: true; resolution: string } | { ok: false; reason: StatusReason } {
  if (!confirmed) return { ok: false, reason: "not_confirmed" };
  const r = typeof resolutionRaw === "string" ? resolutionRaw.trim() : "";
  if (r.length < 1) return { ok: false, reason: "resolution_required" };
  if (r.length > RESOLUTION_MAX) return { ok: false, reason: "resolution_too_long" };
  return { ok: true, resolution: r };
}

export function mapStatusHttp(httpStatus: number): StatusResult {
  if (httpStatus === 200 || httpStatus === 201) return { ok: true };
  if (httpStatus === 400) return { ok: false, reason: "invalid" };
  if (httpStatus === 401 || httpStatus === 403)
    return { ok: false, reason: "denied" };
  if (httpStatus === 404) return { ok: false, reason: "not_found" };
  if (httpStatus === 429) return { ok: false, reason: "rate_limited" };
  return { ok: false, reason: "unavailable" };
}

export function statusReasonLabel(reason: StatusReason): string {
  switch (reason) {
    case "invalid_status":
      return "Choose a valid status.";
    case "resolution_required":
      return "Resolution text is required to close a case.";
    case "resolution_too_long":
      return `Resolution is too long (max ${RESOLUTION_MAX} characters).`;
    case "not_confirmed":
      return "Confirm the close before submitting.";
    case "denied":
      return "Your AnnouPale staff access was not accepted for this action.";
    case "not_found":
      return "This case no longer exists.";
    case "rate_limited":
      return "Too many requests — please wait a moment and try again.";
    case "invalid":
      return "The change was rejected by the compliance service.";
    case "no_session":
      return "Your console session has expired — sign in again.";
    case "unavailable":
    default:
      return "Could not apply the change (native connection unavailable). Try the AnnouPale admin.";
  }
}
