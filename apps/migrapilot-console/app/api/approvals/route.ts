import { NextResponse } from "next/server";

import { listApprovals } from "../../../lib/server/store";
import { sanitize } from "../../../lib/server/sanitize";

export async function GET() {
  return NextResponse.json({ ok: true, data: { approvals: sanitize(listApprovals()) } });
}
