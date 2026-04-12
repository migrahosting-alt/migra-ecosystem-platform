import { NextResponse } from "next/server";

import { readAutonomyState } from "../../../../lib/autonomy/store";
import { buildAutonomyStatusView } from "../../../../lib/autonomy/scheduler";

export async function GET() {
  const state = readAutonomyState();
  return NextResponse.json({
    ok: true,
    data: buildAutonomyStatusView(state)
  });
}
