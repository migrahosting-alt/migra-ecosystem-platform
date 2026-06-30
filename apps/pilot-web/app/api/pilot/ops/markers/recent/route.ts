// GET /api/pilot/ops/markers/recent — Phase 11.3. READ-ONLY recent internal status markers from
// the action journal (sanitized), with the active storage mode. No mutation.

import { actionJournalStoreName } from "../../../../../../lib/pilot/ops-action-journal";
import { safeJson } from "../../../../../../lib/pilot/safe-output";
import { listStatusMarkers } from "../../../../../../lib/pilot/ops-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const raw = Number(new URL(req.url).searchParams.get("limit"));
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(50, Math.floor(raw)) : 20;
  const markers = await listStatusMarkers(limit);
  return safeJson({ store: actionJournalStoreName(), count: markers.length, markers });
}
