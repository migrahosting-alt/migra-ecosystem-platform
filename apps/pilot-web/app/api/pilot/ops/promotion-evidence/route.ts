// GET /api/pilot/ops/promotion-evidence — Phase 12.18. READ-ONLY aggregated promotion evidence bundle.
// Consumes existing sources of truth (status, manifest, precheck, verification commands). EXECUTOR_READY
// stays false; enables nothing, executes nothing, writes nothing. safeJson defense-in-depth.

import { buildPromotionEvidenceBundle } from "../../../../../lib/pilot/promotion-evidence";
import { safeJson } from "../../../../../lib/pilot/safe-output";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return safeJson(buildPromotionEvidenceBundle(new Date().toISOString()));
}
