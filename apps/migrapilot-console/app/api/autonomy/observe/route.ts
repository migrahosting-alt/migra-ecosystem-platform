import { NextResponse } from "next/server";

import { buildAutonomyReport } from "../../../../lib/autonomy/engine/services/report";

export async function POST() {
  const report = buildAutonomyReport();
  return NextResponse.json({ ok: true, data: { generatedAt: report.generatedAt, events: report.events, signals: report.signals } });
}
