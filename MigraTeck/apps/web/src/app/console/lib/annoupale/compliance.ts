import "server-only";
import { getAnnoupaleStaffToken } from "./bridge";
import {
  parseComplianceEnvelope,
  sanitizeCategory,
  sanitizeDate,
  sanitizePriority,
  sanitizeSearch,
  sanitizeSeverity,
  sanitizeStatus,
  type ComplianceQueueData,
  type QueueFailureReason,
} from "./compliance-contract";

/**
 * SERVER-ONLY loader for the native compliance queue.
 *
 * Gets a per-user AnnouPale staff token via the bridge (server-side), fetches
 * the read-only cases list server-side, and runs the contract gate. The token
 * is used only for the Authorization header and is NEVER returned to the caller
 * (so it can never reach client props / the browser).
 */

const CASES_PATH = "/api/admin/compliance/cases";
const DEFAULT_LIMIT = 25;

export type ComplianceQueueParams = {
  status?: string | undefined;
  category?: string | undefined;
  priority?: string | undefined;
  severity?: string | undefined;
  search?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  page?: number | undefined;
};

export type ComplianceQueueResult =
  | ({ connected: true } & ComplianceQueueData)
  | { connected: false; reason: QueueFailureReason };

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

export async function loadComplianceQueue(
  params: ComplianceQueueParams = {},
): Promise<ComplianceQueueResult> {
  const tok = await getAnnoupaleStaffToken();
  if (!tok.ok) return { connected: false, reason: mapTokenReason(tok.reason) };

  const base = process.env.ANNOUPALE_API_BASE_URL;
  if (!base) return { connected: false, reason: "missing_env" };

  const qs = new URLSearchParams();
  const status = sanitizeStatus(params.status);
  const category = sanitizeCategory(params.category);
  const priority = sanitizePriority(params.priority);
  const severity = sanitizeSeverity(params.severity);
  const search = sanitizeSearch(params.search);
  const dateFrom = sanitizeDate(params.dateFrom);
  const dateTo = sanitizeDate(params.dateTo);
  if (status) qs.set("status", status);
  if (category) qs.set("category", category);
  if (priority) qs.set("priority", priority);
  if (severity) qs.set("severity", severity);
  if (search) qs.set("search", search);
  if (dateFrom) qs.set("dateFrom", dateFrom);
  if (dateTo) qs.set("dateTo", dateTo);
  qs.set("page", String(params.page && params.page >= 1 ? params.page : 1));
  qs.set("limit", String(DEFAULT_LIMIT));

  let res: Response;
  try {
    res = await fetch(`${base.replace(/\/+$/, "")}${CASES_PATH}?${qs.toString()}`, {
      headers: { authorization: `Bearer ${tok.accessToken}` },
      cache: "no-store",
    });
  } catch {
    return { connected: false, reason: "bridge_unavailable" };
  }

  if (res.status === 401 || res.status === 403) {
    return { connected: false, reason: "denied" };
  }
  if (res.status === 429) return { connected: false, reason: "rate_limited" };
  if (!res.ok) return { connected: false, reason: "upstream_error" };

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { connected: false, reason: "contract_mismatch" };
  }

  const parsed = parseComplianceEnvelope(json);
  if (!parsed.ok) {
    // Defensive: unexpected shape — never render partial/garbage data.
    console.warn("[annoupale-compliance] contract mismatch on cases response");
    return { connected: false, reason: "contract_mismatch" };
  }

  return { connected: true, ...parsed.data };
}
