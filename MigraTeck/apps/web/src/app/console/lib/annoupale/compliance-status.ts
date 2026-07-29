import "server-only";
import { getSession } from "../auth";
import { getAnnoupaleStaffToken } from "./bridge";
import {
  mapStatusHttp,
  validateClose,
  validateStatusChange,
  type StatusResult,
} from "./compliance-status-contract";
import { PRIORITY_OPTIONS } from "./compliance-contract";

/**
 * SERVER-ONLY status / close mutations for a compliance case.
 *
 * PATCHes the AnnouPale backend with the CURRENT operator's per-user staff
 * token. AnnouPale stays the source of truth and attributes the audit
 * (compliance.case.updated / compliance.case.closed) to the real staff user.
 * The token is used only for the Authorization header — never returned/logged.
 *
 * Scope: status + close only. Never sends priority/assignedTo.
 */

const CASES_PATH = "/api/admin/compliance/cases";

function mapTokenReason(r: string): StatusResult {
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

async function patchCase(
  caseId: string,
  body: Record<string, unknown>,
): Promise<StatusResult> {
  const session = await getSession();
  if (!session) return { ok: false, reason: "no_session" };
  if (!caseId || caseId.length > 200) return { ok: false, reason: "not_found" };

  const tok = await getAnnoupaleStaffToken();
  if (!tok.ok) return mapTokenReason(tok.reason);

  const base = process.env.ANNOUPALE_API_BASE_URL;
  if (!base) return { ok: false, reason: "unavailable" };

  let res: Response;
  try {
    res = await fetch(
      `${base.replace(/\/+$/, "")}${CASES_PATH}/${encodeURIComponent(caseId)}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${tok.accessToken}`,
        },
        body: JSON.stringify(body),
        cache: "no-store",
      },
    );
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  return mapStatusHttp(res.status);
}

/** Non-close status change. */
export async function submitStatusChange(
  caseId: string,
  status: unknown,
): Promise<StatusResult> {
  const v = validateStatusChange(status);
  if (!v.ok) return v;
  return patchCase(caseId, { status });
}

/**
 * Combined triage update (status and/or priority) in one PATCH — backs the
 * "Save Changes" control. Validates each provided field against the known enums;
 * a `closed` status is NOT allowed here (closing requires the dedicated close
 * flow with a resolution + confirmation). At least one field must be provided.
 * Never sends assignedTo (no staff-roster API → assignment stays in AnnouPale).
 */
export async function submitCaseUpdate(
  caseId: string,
  fields: { status?: unknown; priority?: unknown },
): Promise<StatusResult> {
  const body: Record<string, unknown> = {};

  if (fields.status !== undefined && fields.status !== "" && fields.status !== null) {
    if (fields.status === "closed") {
      return { ok: false, reason: "invalid" };
    }
    const v = validateStatusChange(fields.status);
    if (!v.ok) return v;
    body.status = fields.status;
  }

  if (fields.priority !== undefined && fields.priority !== "" && fields.priority !== null) {
    if (!(PRIORITY_OPTIONS as readonly string[]).includes(String(fields.priority))) {
      return { ok: false, reason: "invalid" };
    }
    body.priority = fields.priority;
  }

  if (Object.keys(body).length === 0) return { ok: false, reason: "invalid" };
  return patchCase(caseId, body);
}

/** Close a case with required resolution text + confirmation. */
export async function submitCaseClose(
  caseId: string,
  resolutionRaw: unknown,
  confirmed: boolean,
): Promise<StatusResult> {
  const v = validateClose(resolutionRaw, confirmed);
  if (!v.ok) return v;
  // actionTaken satisfies the backend's close_requires_action_or_note rule.
  return patchCase(caseId, { status: "closed", actionTaken: v.resolution });
}
