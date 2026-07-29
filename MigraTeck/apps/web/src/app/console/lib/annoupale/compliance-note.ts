import "server-only";
import { getSession } from "../auth";
import { getAnnoupaleStaffToken } from "./bridge";
import {
  mapNoteStatus,
  validateNote,
  type NoteResult,
} from "./compliance-note-contract";

/**
 * SERVER-ONLY internal-note mutation.
 *
 * Adds an internal note to a compliance case via the AnnouPale backend, using
 * the CURRENT operator's per-user staff token. AnnouPale remains the source of
 * truth and attributes the audit event (compliance.case.note_added) to the real
 * staff user. The token is only used for the Authorization header and is NEVER
 * returned or logged.
 */

const CASES_PATH = "/api/admin/compliance/cases";

function mapTokenReason(r: string): NoteResult {
  switch (r) {
    case "no_staff_session":
      return { ok: false, reason: "no_session" };
    case "denied":
      return { ok: false, reason: "denied" };
    case "rate_limited":
      return { ok: false, reason: "rate_limited" };
    default:
      return { ok: false, reason: "unavailable" };
  }
}

export async function submitInternalNote(
  caseId: string,
  rawNote: unknown,
): Promise<NoteResult> {
  // Operator must have an authenticated console session.
  const session = await getSession();
  if (!session) return { ok: false, reason: "no_session" };

  if (!caseId || caseId.length > 200) return { ok: false, reason: "not_found" };

  // Server-side validation (in addition to client-side maxLength).
  const v = validateNote(rawNote);
  if (!v.ok) return { ok: false, reason: v.reason };

  const tok = await getAnnoupaleStaffToken();
  if (!tok.ok) return mapTokenReason(tok.reason);

  const base = process.env.ANNOUPALE_API_BASE_URL;
  if (!base) return { ok: false, reason: "unavailable" };

  let res: Response;
  try {
    res = await fetch(
      `${base.replace(/\/+$/, "")}${CASES_PATH}/${encodeURIComponent(caseId)}/note`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${tok.accessToken}`,
        },
        body: JSON.stringify({ note: v.value }),
        cache: "no-store",
      },
    );
  } catch {
    return { ok: false, reason: "unavailable" };
  }

  return mapNoteStatus(res.status);
}
