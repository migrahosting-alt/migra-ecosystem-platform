import { NextResponse } from "next/server";

import { normalizeAutonomyConfig } from "../../../../lib/autonomy/schemas";
import { mergeAutonomyConfig, readAutonomyState } from "../../../../lib/autonomy/store";
import { buildAutonomyStatusView } from "../../../../lib/autonomy/scheduler";

export async function GET() {
  const state = readAutonomyState();
  return NextResponse.json({
    ok: true,
    data: {
      config: state.config,
      status: buildAutonomyStatusView(state)
    }
  });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { config?: unknown };
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { ok: false, error: { code: "VALIDATION_ERROR", message: "config payload is required" } },
      { status: 400 }
    );
  }

  const normalized = normalizeAutonomyConfig(body.config ?? body);
  const state = mergeAutonomyConfig(normalized);

  return NextResponse.json({
    ok: true,
    data: {
      config: state.config,
      status: buildAutonomyStatusView(state)
    }
  });
}
