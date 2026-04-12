import { NextResponse } from "next/server";

import { getMissionState } from "../../../../lib/mission/service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ missionId: string }> }
) {
  const { missionId } = await params;
  try {
    const mission = getMissionState(missionId);
    return NextResponse.json({
      ok: true,
      data: {
        missionId: mission.missionId,
        status: mission.status,
        goal: mission.goal,
        createdAt: mission.createdAt,
        updatedAt: mission.updatedAt,
        planner: mission.planner,
        origin: mission.origin ?? { source: "manual" },
        runIdBase: mission.runIdBase,
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
        lastError: mission.lastError,
        tasks: mission.tasks,
        toolRuns: mission.toolRuns,
        recentToolRuns: mission.toolRuns.slice(-20),
        notes: mission.notes,
        analysis: mission.analysis ?? null,
        proposedAt: mission.proposedAt ?? null,
        proposalExpiresAt: mission.proposalExpiresAt ?? null,
        runnerPolicy: mission.runnerPolicy ?? null,
        environment: mission.environment ?? null,
        dryRun: mission.dryRun ?? null
      }
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
