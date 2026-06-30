// GET /api/pilot/ops/noop/recent — Phase 11.0/11.2. READ-ONLY recent controlled action records,
// via the journal abstraction (in-memory default; dormant Postgres when env-gated). No mutation.

import { actionJournalStoreName, listRecentActionRecords } from "../../../../../../lib/pilot/ops-action-journal";
import { safeJson } from "../../../../../../lib/pilot/safe-output";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const raw = Number(new URL(req.url).searchParams.get("limit"));
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(50, Math.floor(raw)) : 20;
  const records = await listRecentActionRecords(limit);
  return safeJson({ store: actionJournalStoreName(), count: records.length, records });
}
