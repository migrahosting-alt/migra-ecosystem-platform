import { NextResponse } from "next/server";

import { executeNowMission } from "../../../../lib/mission/service";

export async function POST(request: Request) {
  let body: { missionId?: string };
  try {
    body = (await request.json()) as { missionId?: string };
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "VALIDATION_ERROR", message: "Invalid JSON body" } },
      { status: 400 }
    );
  }

  if (!body.missionId || typeof body.missionId !== "string") {
    return NextResponse.json(
      { ok: false, error: { code: "VALIDATION_ERROR", message: "missionId required" } },
      { status: 400 }
    );
  }

  try {
    const mission = await executeNowMission(body.missionId);
    return NextResponse.json({ ok: true, data: { mission } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json(
      { ok: false, error: { code: "MISSION_ERROR", message } },
      { status }
    );
  }
}
