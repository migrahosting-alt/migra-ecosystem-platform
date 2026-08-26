import { NextResponse } from "next/server";

import { approveAction } from "../../../../../../../lib/autonomy/hids-edr-action-store";

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isApproved(request: Request, body: { approvalKey?: unknown }): boolean {
  const required = process.env.MIGRAPILOT_HIDS_EDR_APPROVAL_KEY?.trim();
  if (!required) {
    return true;
  }
  const headerKey = asText(request.headers.get("x-approval-key") ?? "");
  const bodyKey = asText(body.approvalKey);
  return headerKey === required || bodyKey === required;
}

export async function POST(request: Request, { params }: { params: Promise<{ actionId: string }> }) {
  const { actionId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    approvedBy?: unknown;
    approvalKey?: unknown;
  };

  if (!isApproved(request, body)) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "AUTH_ERROR",
          message: "Approval key invalid"
        }
      },
      { status: 401 }
    );
  }

  const approvedBy = asText(body.approvedBy) || "security-operator";
  const approved = approveAction({ actionId, approvedBy });
  if (!approved) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: "Action not found"
        }
      },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true, data: { action: approved } });
}
