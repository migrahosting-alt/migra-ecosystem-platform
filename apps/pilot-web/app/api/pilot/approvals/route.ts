// GET /api/pilot/approvals?limit=N — Phase 9.9. Recent approvals for auditability.
// Returns sanitized summaries only (no raw args; secret-looking keys were already stripped).

import { approvalStoreName, listRecentApprovals, toApprovalSummary } from "../../../../lib/pilot/approval-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(100, Math.floor(raw)) : 20;
  const approvals = (await listRecentApprovals(limit)).map(toApprovalSummary);
  return Response.json({ store: approvalStoreName(), count: approvals.length, approvals });
}
