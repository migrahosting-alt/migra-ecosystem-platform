import { NextResponse } from "next/server";

import type { MissionAnalysis } from "../../../../lib/mission/types";
import { startMission } from "../../../../lib/mission/service";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    goal?: string;
    context?: {
      repoRoot?: string;
      notes?: string;
      focusFile?: string;
      patch?: string;
    };
    runnerPolicy?: {
      default?: "auto" | "local" | "server";
      allowServer?: boolean;
    };
    environment?: "dev" | "stage" | "staging" | "prod" | "test";
    operator?: {
      operatorId?: string;
      role?: string;
      claims?: Record<string, unknown>;
    };
    origin?: {
      source?: "manual" | "autonomy";
      findingId?: string;
      templateId?: string;
    };
    proposeBeforeExecute?: boolean;
    proposalWindowSecs?: number;
    analysis?: MissionAnalysis;
  };

  if (!body.goal || !body.goal.trim()) {
    return NextResponse.json(
      { ok: false, error: { code: "VALIDATION_ERROR", message: "goal is required" } },
      { status: 400 }
    );
  }

  try {
    const started = await startMission({
      goal: body.goal.trim(),
      context: body.context,
      runnerPolicy: {
        default: body.runnerPolicy?.default ?? "auto",
        allowServer: body.runnerPolicy?.allowServer ?? true
      },
      environment: body.environment ?? "dev",
      operator: {
        operatorId: body.operator?.operatorId ?? "console-operator",
        role: body.operator?.role ?? "owner",
        claims: body.operator?.claims
      },
      origin: {
        source: body.origin?.source ?? "manual",
        findingId: body.origin?.findingId,
        templateId: body.origin?.templateId
      },
      proposeBeforeExecute: body.proposeBeforeExecute ?? false,
      proposalWindowSecs: body.proposalWindowSecs,
      analysis: body.analysis
    });

    return NextResponse.json({
      ok: true,
      data: {
        missionId: started.mission.missionId,
        status: started.mission.status,
        planner: started.mission.planner,
        runIdBase: started.mission.runIdBase,
        notes: started.mission.notes,
        analysis: started.mission.analysis ?? null,
        proposalExpiresAt: started.mission.proposalExpiresAt ?? null,
        nextRunnableTasks: started.nextRunnableTasks.map((task) => ({
          taskId: task.taskId,
          lane: task.lane,
          title: task.title
        }))
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
