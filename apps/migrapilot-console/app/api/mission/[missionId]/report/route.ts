import { NextResponse } from "next/server";

import { getMissionReport } from "../../../../../lib/mission/service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ missionId: string }> }
) {
  const { missionId } = await params;
  try {
    const report = await getMissionReport(missionId);
    return NextResponse.json({
      ok: true,
      data: report
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: (error as Error).message
        }
      },
      { status: 404 }
    );
  }
}
