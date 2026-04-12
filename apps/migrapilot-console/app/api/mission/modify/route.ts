import { NextResponse } from "next/server";

import { readAutonomyState } from "../../../../lib/autonomy/store";
import { getMission, updateMission } from "../../../../lib/mission/store";
import type { MissionRunnerPolicy } from "../../../../lib/mission/types";

interface ModifyPayload {
  missionId: string;
  runnerPolicyOverride?: {
    default?: "auto" | "local" | "server";
    allowServer?: boolean;
  };
  environmentOverride?: "dev" | "stage" | "staging" | "prod" | "test";
  proposalWindowSecs?: number;
  dryRun?: boolean;
  maxTasks?: number;
}

function validateGovernance(
  payload: ModifyPayload,
  currentOriginSource: string | undefined,
  autonomyAllowServer: boolean
): string | null {
  // Prod execution via autonomy requires Tier 3 approval — block modification to prod
  if (payload.environmentOverride === "prod" && currentOriginSource === "autonomy") {
    return "Autonomy-sourced missions cannot be overridden to prod environment. Tier 3 approval required.";
  }

  // Server runner must be permitted by autonomy policy
  if (payload.runnerPolicyOverride?.default === "server" && !autonomyAllowServer) {
    return "Server runner override rejected: autonomy policy disallows server runner.";
  }

  if (payload.proposalWindowSecs !== undefined) {
    if (!Number.isInteger(payload.proposalWindowSecs) || payload.proposalWindowSecs < 0) {
      return "proposalWindowSecs must be a non-negative integer.";
    }
  }

  return null;
}

export async function POST(request: Request) {
  let body: ModifyPayload;
  try {
    body = (await request.json()) as ModifyPayload;
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

  const mission = getMission(body.missionId);
  if (!mission) {
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: `Mission not found: ${body.missionId}` } },
      { status: 404 }
    );
  }

  if (mission.status !== "proposed") {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_STATE", message: `Mission must be in proposed status to modify (current: ${mission.status})` } },
      { status: 400 }
    );
  }

  // Governance validation
  const autonomyState = readAutonomyState();
  const governanceError = validateGovernance(
    body,
    mission.origin?.source,
    autonomyState.config.runnerPolicy.allowServer
  );
  if (governanceError) {
    return NextResponse.json(
      { ok: false, error: { code: "GOVERNANCE_VIOLATION", message: governanceError } },
      { status: 403 }
    );
  }

  // Compute new proposal expiry if proposalWindowSecs changed
  let newProposalExpiresAt = mission.proposalExpiresAt;
  if (body.proposalWindowSecs !== undefined && body.proposalWindowSecs > 0) {
    newProposalExpiresAt = new Date(Date.now() + body.proposalWindowSecs * 1000).toISOString();
  } else if (body.proposalWindowSecs === 0) {
    newProposalExpiresAt = undefined;
  }

  // Build updated runner policy
  const newRunnerPolicy: MissionRunnerPolicy = body.runnerPolicyOverride
    ? {
        default: body.runnerPolicyOverride.default ?? mission.runnerPolicy.default,
        allowServer: body.runnerPolicyOverride.allowServer ?? mission.runnerPolicy.allowServer
      }
    : mission.runnerPolicy;

  const updated = updateMission(body.missionId, (m) => ({
    ...m,
    status: "proposed" as const,
    environment: body.environmentOverride ?? m.environment,
    runnerPolicy: newRunnerPolicy,
    dryRun: body.dryRun ?? m.dryRun,
    proposalExpiresAt: newProposalExpiresAt,
    updatedAt: new Date().toISOString(),
    notes: [
      ...m.notes,
      `Plan modified by operator: ${[
        body.environmentOverride ? `env=${body.environmentOverride}` : null,
        body.runnerPolicyOverride ? `runner=${newRunnerPolicy.default}` : null,
        body.dryRun !== undefined ? `dryRun=${body.dryRun}` : null,
        body.proposalWindowSecs !== undefined ? `window=${body.proposalWindowSecs}s` : null
      ]
        .filter(Boolean)
        .join(", ")}`
    ]
  }));

  if (!updated) {
    return NextResponse.json(
      { ok: false, error: { code: "MISSION_ERROR", message: "Mission update failed" } },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, data: { mission: updated } });
}
