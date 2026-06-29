// POST /api/pilot/ops/targets/check — Phase 12.2. READ-ONLY eligibility check for a target+action.
// eligible is ALWAYS false in this phase; nothing executes.

import { checkOpsTarget } from "../../../../../../lib/pilot/ops-target-allowlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let b: { targetId?: unknown; actionName?: unknown } = {};
  try {
    b = await req.json();
  } catch {
    // validated below
  }
  return Response.json(checkOpsTarget(typeof b.targetId === "string" ? b.targetId : "", typeof b.actionName === "string" ? b.actionName : "", new Date().toISOString()));
}
