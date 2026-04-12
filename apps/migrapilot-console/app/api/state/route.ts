import { NextResponse } from "next/server";

import { listApprovals, listConversations, listRuns } from "../../../lib/server/store";
import { sanitize } from "../../../lib/server/sanitize";

export async function GET() {
  return NextResponse.json({
    ok: true,
    data: {
      conversations: sanitize(listConversations()),
      runs: sanitize(listRuns(40)),
      approvals: sanitize(listApprovals())
    }
  });
}
