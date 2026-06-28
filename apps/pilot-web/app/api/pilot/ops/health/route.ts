// GET /api/pilot/ops/health — Phase 10.4. Read-only ops provider status + allowlisted
// health-check results (sanitized URLs, no secrets). No mutation, no approval needed.

import { opsHealth } from "../../../../../lib/pilot/ops-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await opsHealth());
}
