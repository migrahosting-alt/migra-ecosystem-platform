// POST /api/pilot/ops/hazard — Phase 10.4. Read-only grounded hazard/service lookup over
// the Phase 10.2 ecosystem docs. Returns matching sections only (no hardcoded facts).

import { hazardLookup } from "../../../../../lib/pilot/ops-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { query?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // handled by lookup
  }
  const query = typeof body.query === "string" ? body.query : "";
  return Response.json(await hazardLookup(query));
}
