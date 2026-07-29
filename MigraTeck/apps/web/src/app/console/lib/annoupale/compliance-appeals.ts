import "server-only";
import {
  loadComplianceQueue,
  type ComplianceQueueResult,
} from "./compliance";

/**
 * SERVER-ONLY read-only appeals loader.
 *
 * Appeals are compliance cases with category="appeal" (public enforcement
 * appeals submitted via /appeals → compliance). This reuses the verified
 * compliance list contract + per-user-token loader, forcing category=appeal.
 * No separate read-only appeals-list endpoint exists in the moderation module
 * (its caseType filter is not implemented), so this is the safe source. The
 * token never leaves the server; PII is dropped by the shared mapper.
 */

export type AppealsQueueResult = ComplianceQueueResult;

export async function loadAppeals(
  params: { status?: string | undefined; priority?: string | undefined; page?: number | undefined } = {},
): Promise<AppealsQueueResult> {
  return loadComplianceQueue({
    status: params.status,
    priority: params.priority,
    page: params.page,
    category: "appeal",
  });
}
