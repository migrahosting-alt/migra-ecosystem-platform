import { NextResponse } from "next/server";

import { buildAutonomyReport } from "../../../../lib/autonomy/engine/services/report";
import { executeActionPlan } from "../../../../lib/autonomy/engine/services/action-executor";
import { emitAutonomyAction } from "../../../../lib/activity/store";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { executeLowRisk?: boolean };
  const report = buildAutonomyReport({ executeLowRisk: body.executeLowRisk === true });
  const outcomes = await executeActionPlan(report.actions, { executeLowRisk: body.executeLowRisk === true });
  for (const outcome of outcomes) {
    emitAutonomyAction({
      actionType: outcome.type,
      targetSystem: outcome.targetSystem,
      status: outcome.status,
      detail: outcome.detail,
      suggestedCommand: outcome.suggestedCommand,
      riskLevel:
        outcome.status === "failed"
          ? "critical"
          : outcome.status === "gated"
            ? "warn"
            : "info",
    });
  }
  return NextResponse.json({
    ok: true,
    data: {
      generatedAt: report.generatedAt,
      actions: report.actions,
      outcomes,
      executed: outcomes.filter((action) => action.status === "executed").length,
      gated: outcomes.filter((action) => action.status === "gated").length,
      failed: outcomes.filter((action) => action.status === "failed").length
    }
  });
}
