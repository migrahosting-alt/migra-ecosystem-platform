import { NextResponse } from "next/server";

import { buildAutonomyReport } from "../../../../lib/autonomy/engine/services/report";

export async function GET() {
  return NextResponse.json({ ok: true, data: buildAutonomyReport() });
}
