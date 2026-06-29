// GET /api/pilot/ops/noop/recent — Phase 11.0. READ-ONLY recent controlled no-op records
// (in-memory journal, resets on restart). No mutation.

import { listNoopRecords } from "../../../../../../lib/pilot/ops-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const raw = Number(new URL(req.url).searchParams.get("limit"));
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(50, Math.floor(raw)) : 20;
  const records = listNoopRecords(limit);
  return Response.json({ count: records.length, records });
}
