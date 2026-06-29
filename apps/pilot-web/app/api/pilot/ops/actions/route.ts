// GET /api/pilot/ops/actions — Phase 11.1. READ-ONLY controlled ops action registry.
// Sanitized entries only (env NAMES, never values); no execution.

import { listOpsActions } from "../../../../../lib/pilot/ops-action-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(listOpsActions());
}
