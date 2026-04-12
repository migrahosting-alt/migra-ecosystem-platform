import { NextResponse } from "next/server";

import { confirmProposedMission } from "../../../../lib/mission/service";

export async function POST(request: Request) {
  let missionId: string | undefined;
  try {
    const body = (await request.json()) as { missionId?: string };
    missionId = body.missionId?.trim();
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "VALIDATION_ERROR", message: "Invalid JSON body" } },
      { status: 400 }
    );
  }

  if (!missionId) {
    return NextResponse.json(
      { ok: false, error: { code: "VALIDATION_ERROR", message: "missionId is required" } },
      { status: 400 }
    );
  }

  try {
    const mission = confirmProposedMission(missionId);
    return NextResponse.json({ ok: true, data: { missionId: mission.missionId, status: mission.status } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: { code: "CONFIRM_FAILED", message: error instanceof Error ? error.message : String(error) } },
      { status: 400 }
    );
  }
}
