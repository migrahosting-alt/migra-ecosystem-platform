import { NextResponse } from "next/server";

import { listMissionStates } from "../../../../lib/mission/service";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? "100");
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 500)) : 100;

  const missions = listMissionStates(limit);
  return NextResponse.json({
    ok: true,
    data: {
      missions: missions.map((mission) => ({
        missionId: mission.missionId,
        createdAt: mission.createdAt,
        updatedAt: mission.updatedAt,
        goal: mission.goal,
        environment: mission.environment,
        status: mission.status,
        planner: mission.planner,
        origin: mission.origin ?? { source: "manual" },
        completedTasks: mission.tasks.filter((task) => task.status === "done").length,
        totalTasks: mission.tasks.length,
        pendingApproval: mission.pendingApproval,
        lastError: mission.lastError
      }))
    }
  });
}
