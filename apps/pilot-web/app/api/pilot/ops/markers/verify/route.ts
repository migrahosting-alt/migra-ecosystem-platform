// POST /api/pilot/ops/markers/verify — Phase 11.3. READ-ONLY. Verifies a status marker exists
// for a target (and optional status). Mutates nothing. Setting a marker is approval-gated (chat flow).

import { verifyStatusMarker } from "../../../../../../lib/pilot/ops-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let b: { target?: unknown; status?: unknown } = {};
  try {
    b = await req.json();
  } catch {
    // validated below
  }
  return Response.json(await verifyStatusMarker({ target: typeof b.target === "string" ? b.target : "", status: typeof b.status === "string" && b.status ? b.status : undefined }));
}
