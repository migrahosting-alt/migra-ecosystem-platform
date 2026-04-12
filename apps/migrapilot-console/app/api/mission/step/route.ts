import { NextResponse } from "next/server";

import { stepMission } from "../../../../lib/mission/service";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    missionId?: string;
    maxTasks?: number;
  };

  if (!body.missionId) {
    return NextResponse.json(
      { ok: false, error: { code: "VALIDATION_ERROR", message: "missionId is required" } },
      { status: 400 }
    );
  }

  try {
    const mission = await stepMission({
      missionId: body.missionId,
      maxTasks: body.maxTasks
    });

    return NextResponse.json({
      ok: true,
      data: {
        missionId: mission.missionId,
        status: mission.status,
        currentTasks: mission.tasks
          .filter((task) => ["running", "pending", "awaiting_approval"].includes(task.status))
          .map((task) => ({
            taskId: task.taskId,
            lane: task.lane,
            title: task.title,
            status: task.status
          })),
        completedTasks: mission.tasks.filter((task) => task.status === "done").length,
        pendingApproval: mission.pendingApproval,
        lastError: mission.lastError
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
