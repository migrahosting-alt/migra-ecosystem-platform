// GET /api/pilot/runs — Phase 1. Lists runs (most recent first) from the in-memory store.

import { listRuns } from "../../../../lib/pilot/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ runs: listRuns() });
}
