import { NextResponse } from "next/server";

import { createAction, listActions, markExecuted } from "../../../../../lib/autonomy/hids-edr-action-store";
import { verifyAgentToken } from "../../../../../lib/autonomy/hids-edr-agent-store";

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) {
    return "";
  }
  return header.slice(7).trim();
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const agentId = asText(url.searchParams.get("agentId") ?? "");
  const status = asText(url.searchParams.get("status") ?? "") as "pending" | "approved" | "executed" | "rejected";
  const limitRaw = Number(url.searchParams.get("limit") ?? "100");
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(5000, limitRaw)) : 100;

  if (agentId) {
    const token = bearerToken(request);
    const agent = verifyAgentToken(agentId, token);
    if (!agent) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "AUTH_ERROR",
            message: "Invalid agent token"
          }
        },
        { status: 401 }
      );
    }
  }

  return NextResponse.json({
    ok: true,
    data: {
      actions: listActions({
        agentId: agentId || undefined,
        status: status || undefined,
        limit
      })
    }
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    mode?: unknown;
    agentId?: unknown;
    findingId?: unknown;
    action?: unknown;
    objective?: unknown;
    actionId?: unknown;
    executionNotes?: unknown;
  };

  const mode = asText(body.mode) || "request";

  if (mode === "ack") {
    const actionId = asText(body.actionId);
    const executionNotes = asText(body.executionNotes) || "agent execution completed";
    if (!actionId) {
      return NextResponse.json({ ok: false, error: { code: "VALIDATION_ERROR", message: "actionId is required" } }, { status: 400 });
    }
    const updated = markExecuted({ actionId, executionNotes });
    if (!updated) {
      return NextResponse.json({ ok: false, error: { code: "NOT_FOUND", message: "Action not found" } }, { status: 404 });
    }
    return NextResponse.json({ ok: true, data: { action: updated } });
  }

  const agentId = asText(body.agentId);
  const action = asText(body.action);
  const objective = asText(body.objective);
  if (!agentId || !action || !objective) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "agentId, action, and objective are required"
        }
      },
      { status: 400 }
    );
  }

  const created = createAction({
    agentId,
    findingId: asText(body.findingId) || undefined,
    action,
    objective
  });
  return NextResponse.json({ ok: true, data: { action: created } });
}
