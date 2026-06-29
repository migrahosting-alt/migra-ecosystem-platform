// GET /api/pilot/ops/targets — Phase 12.2. READ-ONLY dev ops target allowlist (sanitized).
// Production targets are never eligible; nothing executes.

import { listOpsTargets } from "../../../../../lib/pilot/ops-target-allowlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(listOpsTargets());
}
