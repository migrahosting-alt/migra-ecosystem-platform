// GET /api/pilot/ops/actions/journal — Phase 11.2. READ-ONLY recent controlled action records
// from the journal abstraction, with the active storage mode (memory | postgres). No mutation.

import { actionJournalStoreName, listRecentActionRecords } from "../../../../../../lib/pilot/ops-action-journal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const raw = Number(new URL(req.url).searchParams.get("limit"));
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(50, Math.floor(raw)) : 20;
  const records = await listRecentActionRecords(limit);
  return Response.json({ store: actionJournalStoreName(), count: records.length, records });
}
