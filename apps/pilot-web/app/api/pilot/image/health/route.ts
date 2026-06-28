// GET /api/pilot/image/health — Phase 9.7. Read-only image-provider status (no secrets exposed).

import { imageHealth } from "../../../../../lib/pilot/image-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await imageHealth());
}
