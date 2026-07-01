// GET /api/pilot/ops/promotion-status — Phase 12.16. READ-ONLY executor promotion-gate status.
// Reflects the 12.15 checklist data (EXECUTOR_READY stays false). Enables nothing, executes nothing.
// Wrapped with safeJson (payload carries free-form requirement/summary text) — defense-in-depth.

import { buildPromotionStatus } from "../../../../../lib/pilot/promotion-status";
import { safeJson } from "../../../../../lib/pilot/safe-output";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return safeJson(buildPromotionStatus(new Date().toISOString()));
}
