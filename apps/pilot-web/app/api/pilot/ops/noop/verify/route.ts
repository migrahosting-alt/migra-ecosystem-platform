// POST /api/pilot/ops/noop/verify — Phase 11.0. READ-ONLY. Verifies a no-op record (+ optional
// allowlisted health check). Mutates nothing. Execution itself is approval-gated (chat flow).

import { verifyNoop } from "../../../../../../lib/pilot/ops-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let b: { target?: unknown; healthUrl?: unknown } = {};
  try {
    b = await req.json();
  } catch {
    // validated below
  }
  return Response.json(await verifyNoop({ target: typeof b.target === "string" ? b.target : "", healthUrl: typeof b.healthUrl === "string" && b.healthUrl ? b.healthUrl : undefined }));
}
