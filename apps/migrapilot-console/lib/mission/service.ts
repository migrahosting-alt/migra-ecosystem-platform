import { randomUUID } from "node:crypto";

import {
  emitMissionCompleted,
  emitMissionFailed,
  emitMissionProposed,
  emitMissionStarted,
  emitProposalCancelled,
  emitProposalConfirmed
} from "../activity/store";
import { validateTaskGraph } from "./schemas";
import { stepMissionExecution } from "./executor";
import { planMission } from "./planner";
import { buildMissionReport } from "./report";
import { persistMissionReportArtifacts } from "./report-artifacts";
import { createMission, getMission, listMissions, updateMission } from "./store";
import type {
  MissionProgressView,
  MissionRecord,
  MissionReport,
  StartMissionInput,
  StepMissionInput
} from "./types";

const DEFAULT_PROPOSAL_WINDOW_SECS = 30;

function getRunnableTasks(mission: MissionRecord) {
  return mission.tasks.filter((task) => {
    if (task.status !== "pending") {
      return false;
    }
    return task.deps.every((dep) => mission.tasks.find((candidate) => candidate.taskId === dep)?.status === "done");
  });
}

function progressView(mission: MissionRecord): MissionProgressView {
  return {
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
  };
}

export async function startMission(input: StartMissionInput): Promise<{
  mission: MissionRecord;
  nextRunnableTasks: MissionRecord["tasks"];
}> {
  const runnerPolicy = input.runnerPolicy ?? { default: "auto", allowServer: true };
  const planned = await planMission({
    goal: input.goal,
    context: input.context,
    environment: input.environment,
    operator: input.operator,
    runnerPolicy
  });

  if (!validateTaskGraph(planned.taskGraph)) {
    throw new Error("Planner returned invalid task graph");
  }

  const missionId = `mission_${randomUUID()}`;
  const createdAt = new Date().toISOString();
  const propose = Boolean(input.proposeBeforeExecute);
  const proposalWindowSecs = input.proposalWindowSecs ?? DEFAULT_PROPOSAL_WINDOW_SECS;

  const mission: MissionRecord = {
    missionId,
    createdAt,
    updatedAt: createdAt,
    goal: input.goal,
    context: input.context,
    operator: input.operator,
    environment: input.environment,
    runnerPolicy,
    runIdBase: `run_${missionId}`,
    status: propose ? "proposed" : "pending",
    planner: planned.planner,
    origin: input.origin ?? { source: "manual" },
    tasks: planned.taskGraph.tasks,
    toolRuns: [],
    notes: planned.notes,
    analysis: input.analysis,
    proposedAt: propose ? createdAt : undefined,
    proposalExpiresAt: propose
      ? new Date(Date.parse(createdAt) + proposalWindowSecs * 1000).toISOString()
      : undefined
  };

  const persisted = createMission(mission);

  if (propose) {
    emitMissionProposed({
      missionId: persisted.missionId,
      goal: persisted.goal,
      confidence: input.analysis?.confidence ?? 0.8,
      riskLevel: input.analysis?.riskLevel ?? "warn"
    });
  } else {
    emitMissionStarted({ missionId: persisted.missionId, goal: persisted.goal });
  }

  return {
    mission: persisted,
    nextRunnableTasks: getRunnableTasks(persisted)
  };
}

export async function stepMission(input: StepMissionInput): Promise<MissionRecord> {
  const current = getMission(input.missionId);
  if (!current) {
    throw new Error(`Mission not found: ${input.missionId}`);
  }

  const stepped = await stepMissionExecution(current, input.maxTasks);
  const updated = updateMission(input.missionId, () => stepped);
  if (!updated) {
    throw new Error(`Mission update failed: ${input.missionId}`);
  }

  if (updated.status === "completed") {
    emitMissionCompleted({ missionId: updated.missionId, goal: updated.goal });
  } else if (updated.status === "failed") {
    emitMissionFailed({ missionId: updated.missionId, goal: updated.goal, error: updated.lastError });
  }

  return updated;
}

export function confirmProposedMission(missionId: string): MissionRecord {
  const current = getMission(missionId);
  if (!current) {
    throw new Error(`Mission not found: ${missionId}`);
  }
  if (current.status !== "proposed") {
    throw new Error(`Mission ${missionId} is not in proposed status (current: ${current.status})`);
  }

  const updated = updateMission(missionId, (m) => ({
    ...m,
    status: "pending" as const,
    updatedAt: new Date().toISOString(),
    notes: [...m.notes, "Proposal confirmed by operator."]
  }));
  if (!updated) {
    throw new Error(`Mission update failed: ${missionId}`);
  }

  emitProposalConfirmed({ missionId: updated.missionId, goal: updated.goal });
  emitMissionStarted({ missionId: updated.missionId, goal: updated.goal });
  return updated;
}

export function cancelProposedMission(missionId: string): MissionRecord {
  const current = getMission(missionId);
  if (!current) {
    throw new Error(`Mission not found: ${missionId}`);
  }
  if (current.status !== "proposed") {
    throw new Error(`Mission ${missionId} is not in proposed status`);
  }

  const updated = updateMission(missionId, (m) => ({
    ...m,
    status: "canceled" as const,
    updatedAt: new Date().toISOString(),
    notes: [...m.notes, "Proposal cancelled by operator."]
  }));
  if (!updated) {
    throw new Error(`Mission update failed: ${missionId}`);
  }

  emitProposalCancelled({ missionId: updated.missionId, goal: updated.goal });
  return updated;
}

export async function executeNowMission(missionId: string): Promise<MissionRecord> {
  // Confirm proposal immediately (proposed → pending), then step to begin execution
  confirmProposedMission(missionId);
  return stepMission({ missionId, maxTasks: 1 });
}

export function getMissionState(missionId: string): MissionRecord {
  const mission = getMission(missionId);
  if (!mission) {
    throw new Error(`Mission not found: ${missionId}`);
  }
  return mission;
}

export function getMissionProgress(missionId: string): MissionProgressView {
  return progressView(getMissionState(missionId));
}

export function listMissionStates(limit = 100): MissionRecord[] {
  return listMissions(limit);
}

export function cancelMission(missionId: string): MissionRecord {
  const mission = updateMission(missionId, (current) => ({
    ...current,
    status: "canceled" as const,
    notes: [...current.notes, "Mission canceled by operator"]
  }));
  if (!mission) {
    throw new Error(`Mission not found: ${missionId}`);
  }
  emitMissionFailed({ missionId: mission.missionId, goal: mission.goal, error: "Canceled by operator" });
  return mission;
}

export async function getMissionReport(missionId: string): Promise<MissionReport> {
  const mission = getMissionState(missionId);
  const report = await buildMissionReport(mission);
  return persistMissionReportArtifacts(report);
}
