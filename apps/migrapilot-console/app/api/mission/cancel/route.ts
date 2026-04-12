import { NextResponse } from "next/server";

import { cancelMission } from "../../../../lib/mission/service";

export async function POST(request: Request) {
  const body = (await request.json()) as { missionId?: string };
  if (!body.missionId) {
    return NextResponse.json(
      { ok: false, error: { code: "VALIDATION_ERROR", message: "missionId is required" } },
      { status: 400 }
    );
  }

  try {
    const mission = cancelMission(body.missionId);
    return NextResponse.json({
      ok: true,
      data: {
        missionId: mission.missionId,
        status: mission.status
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: (error as Error).message
        }
      },
      { status: 500 }
    );
  }
}
