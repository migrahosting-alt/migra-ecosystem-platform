import { NextResponse } from "next/server";

import { createEnrollment, listAgents } from "../../../../../lib/autonomy/hids-edr-agent-store";

interface EnrollBody {
  name?: unknown;
  host?: unknown;
  os?: unknown;
  certificatePem?: unknown;
  publicKey?: unknown;
  enrollKey?: unknown;
}

function asText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function enrollmentAllowed(body: EnrollBody): boolean {
  const requiredKey = process.env.MIGRAPILOT_HIDS_EDR_ENROLL_KEY?.trim();
  if (!requiredKey) {
    return true;
  }
  return asText(body.enrollKey) === requiredKey;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? "100");
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, limitRaw)) : 100;

  return NextResponse.json({
    ok: true,
    data: {
      agents: listAgents(limit)
    }
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as EnrollBody;
  if (!enrollmentAllowed(body)) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "AUTH_ERROR",
          message: "Invalid enrollment key"
        }
      },
      { status: 401 }
    );
  }

  const name = asText(body.name);
  const host = asText(body.host);
  const os = asText(body.os);
  if (!name || !host || !os) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "name, host, and os are required"
        }
      },
      { status: 400 }
    );
  }

  const enrollment = createEnrollment({
    name,
    host,
    os,
    certificatePem: asText(body.certificatePem) || undefined,
    publicKey: asText(body.publicKey) || undefined
  });

  return NextResponse.json({
    ok: true,
    data: {
      agentId: enrollment.agent.agentId,
      token: enrollment.token,
      ingestPath: "/api/autonomy/hids-edr",
      heartbeatPath: "/api/autonomy/hids-edr/heartbeat"
    }
  });
}
