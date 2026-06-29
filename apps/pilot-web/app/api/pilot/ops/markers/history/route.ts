// POST /api/pilot/ops/markers/history — Phase 11.5. READ-ONLY status marker history (set +
// transitions) for a target or markerId. Sanitized; mutates nothing.

import { statusMarkerHistory } from "../../../../../../lib/pilot/ops-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let b: { target?: unknown; markerId?: unknown } = {};
  try {
    b = await req.json();
  } catch {
    // validated below
  }
  const history = await statusMarkerHistory({ target: typeof b.target === "string" && b.target ? b.target : undefined, markerId: typeof b.markerId === "string" && b.markerId ? b.markerId : undefined });
  return Response.json({ count: history.length, history });
}
