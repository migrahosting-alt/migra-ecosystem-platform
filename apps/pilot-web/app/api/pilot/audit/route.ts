// GET /api/pilot/audit — Phase 8. Returns the audit trail (most recent first).

import { listAudit } from "../../../../lib/pilot/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ events: listAudit() });
}
