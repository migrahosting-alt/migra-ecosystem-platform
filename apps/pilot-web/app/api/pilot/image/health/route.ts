// GET /api/pilot/image/health — Phase 9.7. Read-only image-provider status (no secrets exposed).

import { imageHealth } from "../../../../../lib/pilot/image-provider";
import { safeJson } from "../../../../../lib/pilot/safe-output";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return safeJson(await imageHealth());
}
