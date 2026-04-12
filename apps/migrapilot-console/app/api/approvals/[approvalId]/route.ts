import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { executeToolWithPolicy } from "../../../../lib/server/tool-runtime";
import { listApprovals, recordRun, updateApproval } from "../../../../lib/server/store";
import { sanitize } from "../../../../lib/server/sanitize";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ approvalId: string }> }
) {
  const { approvalId } = await params;
  const body = (await request.json()) as {
    action?: "approve" | "reject";
    humanKeyTurnCode?: string;
  };

  const approval = listApprovals().find((item) => item.id === approvalId);
  if (!approval) {
    return NextResponse.json({ ok: false, error: { code: "NOT_FOUND", message: "Approval not found" } }, { status: 404 });
  }

  if (body.action === "reject") {
    const updated = updateApproval(approvalId, { status: "rejected" });
    return NextResponse.json({ ok: true, data: { approval: sanitize(updated) } });
  }

  if (!body.humanKeyTurnCode) {
    return NextResponse.json(
      { ok: false, error: { code: "VALIDATION_ERROR", message: "humanKeyTurnCode is required" } },
      { status: 400 }
    );
  }

  const updated = updateApproval(approvalId, {
    status: "approved",
    humanKeyTurnCode: body.humanKeyTurnCode
  });

  const rerunId = `run_${randomUUID()}`;
  const execution = await executeToolWithPolicy({
    ...approval.request,
    humanKeyTurnCode: body.humanKeyTurnCode,
    runId: rerunId
  });

  recordRun({
    id: rerunId,
    createdAt: new Date().toISOString(),
    status: execution.result.ok ? "completed" : "failed",
    overlay: execution.overlay,
    input: sanitize(approval.request.input) as Record<string, unknown>,
    output: sanitize(execution.result) as typeof execution.result,
    error: execution.result.error?.message
  });

  return NextResponse.json({
    ok: true,
    data: {
      approval: sanitize(updated),
      runId: rerunId,
      overlay: execution.overlay,
      result: sanitize(execution.result)
    }
  });
}
