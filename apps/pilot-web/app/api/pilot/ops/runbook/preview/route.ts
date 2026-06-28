// POST /api/pilot/ops/runbook/preview — Phase 10.7. READ-ONLY runbook preview (validates
// inputs, lists sections). Generates no runbook and executes nothing. Full generation is
// approval-gated via the ops.runbook.generate tool (chat flow).

import { previewRunbook } from "../../../../../../lib/pilot/ops-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let b: Record<string, unknown> = {};
  try {
    b = await req.json();
  } catch {
    // validated below
  }
  return Response.json(
    previewRunbook({
      actionType: typeof b.actionType === "string" ? b.actionType : "",
      target: typeof b.target === "string" ? b.target : "",
      objective: typeof b.objective === "string" ? b.objective : undefined,
      includeCommands: typeof b.includeCommands === "boolean" ? b.includeCommands : undefined,
      includeRollback: typeof b.includeRollback === "boolean" ? b.includeRollback : undefined,
      includeVerification: typeof b.includeVerification === "boolean" ? b.includeVerification : undefined,
    }),
  );
}
