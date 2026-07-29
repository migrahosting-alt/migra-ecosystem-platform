import "server-only";
import { getAnnoupaleStaffToken } from "./bridge";
import { type QueueFailureReason } from "./compliance-contract";
import {
  parseComplianceCaseDetail,
  type ComplianceCaseDetail,
} from "./compliance-detail-contract";

/**
 * SERVER-ONLY loader for a single compliance case detail.
 *
 * Gets a per-user AnnouPale staff token via the bridge, server-side fetches the
 * case, and runs the contract gate. The token is only used for the Authorization
 * header and is NEVER returned (never reaches client props / the browser).
 */

const CASES_PATH = "/api/admin/compliance/cases";

function mapTokenReason(r: string): QueueFailureReason {
  switch (r) {
    case "no_staff_session":
      return "no_session";
    case "missing_env":
      return "missing_env";
    case "denied":
      return "denied";
    case "rate_limited":
      return "rate_limited";
    case "bridge_unavailable":
      return "bridge_unavailable";
    default:
      return "upstream_error";
  }
}

export type ComplianceCaseResult =
  | { status: "ok"; detail: ComplianceCaseDetail }
  | { status: "not_found" }
  | { status: "unavailable"; reason: QueueFailureReason };

export async function loadComplianceCase(
  caseId: string,
): Promise<ComplianceCaseResult> {
  if (!caseId || caseId.length > 200) return { status: "not_found" };

  const tok = await getAnnoupaleStaffToken();
  if (!tok.ok) return { status: "unavailable", reason: mapTokenReason(tok.reason) };

  const base = process.env.ANNOUPALE_API_BASE_URL;
  if (!base) return { status: "unavailable", reason: "missing_env" };

  let res: Response;
  try {
    res = await fetch(
      `${base.replace(/\/+$/, "")}${CASES_PATH}/${encodeURIComponent(caseId)}`,
      {
        headers: { authorization: `Bearer ${tok.accessToken}` },
        cache: "no-store",
      },
    );
  } catch {
    return { status: "unavailable", reason: "bridge_unavailable" };
  }

  if (res.status === 404) return { status: "not_found" };
  if (res.status === 401 || res.status === 403) {
    return { status: "unavailable", reason: "denied" };
  }
  if (res.status === 429) return { status: "unavailable", reason: "rate_limited" };
  if (!res.ok) return { status: "unavailable", reason: "upstream_error" };

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { status: "unavailable", reason: "contract_mismatch" };
  }

  const parsed = parseComplianceCaseDetail(json);
  if (!parsed.ok) {
    console.warn("[annoupale-compliance] contract mismatch on case detail");
    return { status: "unavailable", reason: "contract_mismatch" };
  }
  return { status: "ok", detail: parsed.detail };
}
