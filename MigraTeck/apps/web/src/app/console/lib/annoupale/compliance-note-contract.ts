/**
 * Contract + validation for adding a compliance internal note
 * (POST /api/admin/compliance/cases/:id/note — body { note }).
 *
 * PURE module (no server-only / next imports) so it is unit-testable. Mirrors
 * the AnnouPale backend `noteSchema`: z.string().trim().min(1).max(5000).
 */

export const NOTE_MIN = 1;
export const NOTE_MAX = 5000;

export type NoteReason =
  | "empty"
  | "too_long"
  | "denied" // 401 / 403
  | "not_found" // 404
  | "rate_limited" // 429
  | "invalid" // 400 (server-side validation)
  | "no_session"
  | "unavailable"; // bridge/network/upstream

export type NoteResult = { ok: true } | { ok: false; reason: NoteReason };

export type NoteValidation =
  | { ok: true; value: string }
  | { ok: false; reason: "empty" | "too_long" };

/** Trim + length check, matching the backend contract. */
export function validateNote(raw: unknown): NoteValidation {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (v.length < NOTE_MIN) return { ok: false, reason: "empty" };
  if (v.length > NOTE_MAX) return { ok: false, reason: "too_long" };
  return { ok: true, value: v };
}

/** Map an HTTP status from the note endpoint to a safe result. */
export function mapNoteStatus(status: number): NoteResult {
  if (status === 200 || status === 201) return { ok: true };
  if (status === 400) return { ok: false, reason: "invalid" };
  if (status === 401 || status === 403) return { ok: false, reason: "denied" };
  if (status === 404) return { ok: false, reason: "not_found" };
  if (status === 429) return { ok: false, reason: "rate_limited" };
  return { ok: false, reason: "unavailable" };
}

export function noteReasonLabel(reason: NoteReason): string {
  switch (reason) {
    case "empty":
      return "Enter a note before submitting.";
    case "too_long":
      return `Note is too long (max ${NOTE_MAX} characters).`;
    case "denied":
      return "Your AnnouPale staff access was not accepted for this action.";
    case "not_found":
      return "This case no longer exists.";
    case "rate_limited":
      return "Too many requests — please wait a moment and try again.";
    case "invalid":
      return "The note was rejected by the compliance service.";
    case "no_session":
      return "Your console session has expired — sign in again.";
    case "unavailable":
    default:
      return "Could not save the note (native connection unavailable). Try the AnnouPale admin.";
  }
}
