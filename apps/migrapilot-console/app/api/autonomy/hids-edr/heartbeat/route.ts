import { NextResponse } from "next/server";

import { registerNonce } from "../../../../../lib/autonomy/hids-edr-ingest-guard";
import { updateHeartbeat, verifyAgentToken } from "../../../../../lib/autonomy/hids-edr-agent-store";

interface HeartbeatBody {
  agentId?: unknown;
  nonce?: unknown;
  timestampMs?: unknown;
  status?: unknown;
}

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

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as HeartbeatBody;
  const agentId = asText(body.agentId);
  const nonce = asText(body.nonce);
  const timestampMs = Number(body.timestampMs);
  const statusRaw = asText(body.status).toLowerCase();
  const status = statusRaw === "degraded" || statusRaw === "offline" ? statusRaw : "healthy";

  if (!agentId || !nonce || !Number.isFinite(timestampMs)) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "agentId, nonce, and timestampMs are required"
        }
      },
      { status: 400 }
    );
  }

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

  const nonceGate = registerNonce({ agentId, nonce, timestampMs });
  if (!nonceGate.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: nonceGate.code,
          message: nonceGate.message
        }
      },
      { status: 409 }
    );
  }

  const updated = updateHeartbeat({ agentId, status });
  if (!updated) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: "Agent not found"
        }
      },
      { status: 404 }
    );
  }

  return NextResponse.json({
    ok: true,
    data: {
      agentId: updated.agentId,
      lastHeartbeatAt: updated.lastHeartbeatAt,
      heartbeatStatus: updated.heartbeatStatus
    }
  });
}
