import { listApprovals } from "../server/store";
import { executeViaBrainApi } from "./execute-api";
import type { MissionRecord, MissionTask, MissionTaskStatus } from "./types";

const DEFAULT_MAX_TASKS = 3;
const MAX_CONCURRENCY = 3;
const MAX_STEPS_PER_MISSION = 100;

function isTaskDone(status: MissionTaskStatus): boolean {
  return status === "done" || status === "skipped";
}

function depsSatisfied(task: MissionTask, tasks: MissionTask[]): boolean {
  if (task.deps.length === 0) {
    return true;
  }
  return task.deps.every((dep) => {
    const depTask = tasks.find((candidate) => candidate.taskId === dep);
    return depTask ? isTaskDone(depTask.status) : false;
  });
}

function getRunnableTasks(mission: MissionRecord): MissionTask[] {
  return mission.tasks.filter((task) => task.status === "pending" && depsSatisfied(task, mission.tasks));
}

function rollbackSucceeded(rollback: unknown): boolean {
  if (!rollback || typeof rollback !== "object" || Array.isArray(rollback)) {
    return false;
  }
  const status = (rollback as { status?: string }).status;
  return status === "ROLLBACK_APPLIED" || status === "ALREADY_ROLLED_BACK";
}

function resolveRunnerTarget(task: MissionTask, call: MissionTask["toolCalls"][number]): "local" | "server" {
  if (call.runnerTarget) {
    return call.runnerTarget;
  }
  if (task.lane === "ops") {
    return "server";
  }
  return "local";
}

function mergeMissionUpdate(base: MissionRecord, incoming: MissionRecord, taskId: string): MissionRecord {
  const merged: MissionRecord = {
    ...base,
    tasks: [...base.tasks],
    toolRuns: [...base.toolRuns],
    notes: [...base.notes]
  };

  const incomingTask = incoming.tasks.find((task) => task.taskId === taskId);
  if (incomingTask) {
    const idx = merged.tasks.findIndex((task) => task.taskId === taskId);
    if (idx >= 0) {
      merged.tasks[idx] = incomingTask;
    }
  }

  const existingRunIds = new Set(merged.toolRuns.map((run) => run.id));
  for (const run of incoming.toolRuns) {
    if (!existingRunIds.has(run.id)) {
      merged.toolRuns.push(run);
      existingRunIds.add(run.id);
    }
  }

  const existingNotes = new Set(merged.notes);
  for (const note of incoming.notes) {
    if (!existingNotes.has(note)) {
      merged.notes.push(note);
      existingNotes.add(note);
    }
  }

  if (incoming.pendingApproval) {
    merged.pendingApproval = incoming.pendingApproval;
  }
  if (incoming.lastError) {
    merged.lastError = incoming.lastError;
  }

  if (incoming.status === "awaiting_approval") {
    merged.status = "awaiting_approval";
  } else if (incoming.status === "failed") {
    merged.status = "failed";
  }

  return merged;
}

async function executeTask(mission: MissionRecord, task: MissionTask): Promise<{
  mission: MissionRecord;
  task: MissionTask;
  hardFailure: boolean;
}> {
  const updatedMission = { ...mission, tasks: [...mission.tasks], toolRuns: [...mission.toolRuns], notes: [...mission.notes] };
  const targetTaskIndex = updatedMission.tasks.findIndex((item) => item.taskId === task.taskId);
  if (targetTaskIndex < 0) {
    return { mission, task, hardFailure: false };
  }
  const mutableTask: MissionTask = {
    ...updatedMission.tasks[targetTaskIndex],
    outputsRefs: [...updatedMission.tasks[targetTaskIndex].outputsRefs]
  };
  mutableTask.status = "running";
  updatedMission.tasks[targetTaskIndex] = mutableTask;
  updatedMission.status = "running";

  for (let index = 0; index < mutableTask.toolCalls.length; index += 1) {
    const call = mutableTask.toolCalls[index];
    const runnerTarget = resolveRunnerTarget(mutableTask, call);
    if (runnerTarget === "server" && mission.runnerPolicy.allowServer === false) {
      mutableTask.status = "failed";
      mutableTask.lastError = `${call.toolName}: POLICY_VIOLATION Server runner disallowed by mission policy`;
      updatedMission.lastError = mutableTask.lastError;
      updatedMission.status = "failed";
      updatedMission.tasks[targetTaskIndex] = mutableTask;
      return {
        mission: updatedMission,
        task: mutableTask,
        hardFailure: true
      };
    }

    const runId = `${updatedMission.runIdBase}_${mutableTask.taskId}_${index + 1}`;

    const execution = await executeViaBrainApi({
      runnerTarget,
      toolName: call.toolName,
      toolInput: call.input,
      environment: call.environment ?? updatedMission.environment,
      operator: updatedMission.operator,
      runId,
      autonomyBudgetId: "mission-default"
    });

    if (execution.approvalRequired) {
      mutableTask.status = "awaiting_approval";
      updatedMission.status = "awaiting_approval";
      updatedMission.pendingApproval = {
        approvalId: execution.approvalRequired.approvalId,
        missionId: updatedMission.missionId,
        taskId: mutableTask.taskId,
        toolName: call.toolName,
        riskSummary: execution.approvalRequired.risk ?? "Tier 3 approval required",
        requestedAt: new Date().toISOString()
      };
      updatedMission.notes.push(`Mission paused for approval ${execution.approvalRequired.approvalId}`);
      updatedMission.tasks[targetTaskIndex] = mutableTask;
      return {
        mission: updatedMission,
        task: mutableTask,
        hardFailure: false
      };
    }

    const runRecord = {
      id: `${updatedMission.missionId}_${mutableTask.taskId}_${index + 1}_${Date.now()}`,
      missionId: updatedMission.missionId,
      taskId: mutableTask.taskId,
      toolName: call.toolName,
      runnerUsed: execution.overlay?.runnerType ?? runnerTarget,
      env: execution.overlay?.env ?? (call.environment ?? updatedMission.environment),
      baseTier: execution.overlay?.baseTier ?? 0,
      effectiveTier: execution.overlay?.effectiveTier ?? 0,
      jobId: execution.overlay?.jobId,
      journalEntryId: execution.result?.journalEntryId,
      ok: execution.result?.ok ?? false,
      errorCode: execution.result?.error?.code,
      runId,
      createdAt: new Date().toISOString()
    } as MissionRecord["toolRuns"][number];

    updatedMission.toolRuns.push(runRecord);
    mutableTask.outputsRefs.push({
      jobId: runRecord.jobId,
      journalEntryId: runRecord.journalEntryId,
      toolName: runRecord.toolName,
      runId
    });

    if (!execution.result || !execution.result.ok) {
      const errorMessage = execution.result?.error?.message ?? "Tool execution failed";
      const errorCode = execution.result?.error?.code ?? "INTERNAL_ERROR";
      mutableTask.lastError = `${call.toolName}: ${errorCode} ${errorMessage}`;
      mutableTask.retries += 1;
      const canRetry = mutableTask.retries <= mutableTask.maxRetries;
      const tier = execution.overlay?.effectiveTier ?? 0;
      const nonCritical = Boolean(call.nonCritical ?? mutableTask.nonCritical);
      const rollbackOk = rollbackSucceeded(execution.result?.rollback);
      const hardFailure = tier >= 2 && !rollbackOk;

      if (canRetry) {
        mutableTask.status = "pending";
      } else {
        mutableTask.status = "failed";
      }

      updatedMission.lastError = mutableTask.lastError;
      updatedMission.tasks[targetTaskIndex] = mutableTask;

      if (hardFailure && !nonCritical) {
        updatedMission.status = "failed";
        return {
          mission: updatedMission,
          task: mutableTask,
          hardFailure: true
        };
      }

      if (!nonCritical && !canRetry) {
        updatedMission.status = "failed";
        return {
          mission: updatedMission,
          task: mutableTask,
          hardFailure: true
        };
      }
      return {
        mission: updatedMission,
        task: mutableTask,
        hardFailure: false
      };
    }
  }

  mutableTask.status = "done";
  updatedMission.tasks[targetTaskIndex] = mutableTask;
  return {
    mission: updatedMission,
    task: mutableTask,
    hardFailure: false
  };
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
  shouldStop?: () => boolean
): Promise<void> {
  let index = 0;
  const workers = new Array(Math.min(concurrency, items.length)).fill(null).map(async () => {
    while (index < items.length) {
      if (shouldStop?.()) {
        return;
      }
      const current = items[index];
      index += 1;
      await worker(current);
    }
  });
  await Promise.all(workers);
}

function checkPendingApprovalResolution(mission: MissionRecord): MissionRecord {
  if (!mission.pendingApproval) {
    return mission;
  }

  const approval = listApprovals().find((item) => item.id === mission.pendingApproval?.approvalId);
  if (!approval) {
    return mission;
  }

  const updatedMission = { ...mission, tasks: [...mission.tasks], notes: [...mission.notes] };
  const taskIndex = updatedMission.tasks.findIndex((task) => task.taskId === mission.pendingApproval?.taskId);
  if (approval.status === "pending") {
    updatedMission.status = "awaiting_approval";
    return updatedMission;
  }
  if (taskIndex >= 0 && updatedMission.tasks[taskIndex].status === "awaiting_approval") {
    updatedMission.tasks[taskIndex] = {
      ...updatedMission.tasks[taskIndex],
      status: approval.status === "approved" ? "done" : "failed",
      lastError: approval.status === "rejected" ? "Approval rejected" : undefined
    };
  }

  if (approval.status === "approved") {
    updatedMission.status = "running";
    updatedMission.notes.push(`Approval ${approval.id} approved.`);
    updatedMission.pendingApproval = undefined;
    return updatedMission;
  }

  updatedMission.status = "failed";
  updatedMission.lastError = "Mission approval was rejected";
  updatedMission.notes.push(`Approval ${approval.id} rejected.`);
  updatedMission.pendingApproval = undefined;
  return updatedMission;
}

async function runRequiredQaIfNeeded(mission: MissionRecord): Promise<MissionRecord> {
  const patchOccurred = mission.toolRuns.some((run) => run.toolName === "repo.applyPatch" && run.ok);
  if (!patchOccurred) {
    return mission;
  }
  const qaPassed = mission.toolRuns.some(
    (run) =>
      run.toolName === "repo.run" &&
      run.ok
  );
  if (qaPassed) {
    return mission;
  }

  const execution = await executeViaBrainApi({
    runnerTarget: "local",
    toolName: "repo.run",
    toolInput: {
      cmd: "npm",
      args: ["run", "build"],
      timeoutSec: 180
    },
    environment: "dev",
    operator: mission.operator,
    runId: `${mission.runIdBase}_qa_autocheck`,
    autonomyBudgetId: "mission-default"
  });

  const updated = { ...mission, toolRuns: [...mission.toolRuns], notes: [...mission.notes] };
  updated.toolRuns.push({
    id: `${mission.missionId}_qa_autocheck_${Date.now()}`,
    missionId: mission.missionId,
    taskId: "qa_autocheck",
    toolName: "repo.run",
    runnerUsed: execution.overlay?.runnerType ?? "local",
    env: execution.overlay?.env ?? "dev",
    baseTier: execution.overlay?.baseTier ?? 1,
    effectiveTier: execution.overlay?.effectiveTier ?? 1,
    jobId: execution.overlay?.jobId,
    journalEntryId: execution.result?.journalEntryId,
    ok: execution.result?.ok ?? false,
    errorCode: execution.result?.error?.code,
    runId: `${mission.runIdBase}_qa_autocheck`,
    createdAt: new Date().toISOString()
  });
  if (!execution.result?.ok) {
    updated.status = "failed";
    updated.lastError = "Required QA check failed after patch";
  } else {
    updated.notes.push("Auto QA check passed after patch apply.");
  }
  return updated;
}

export async function stepMissionExecution(mission: MissionRecord, maxTasks?: number): Promise<MissionRecord> {
  let workingMission = checkPendingApprovalResolution(mission);
  if (workingMission.status === "awaiting_approval") {
    return workingMission;
  }
  if (workingMission.status === "failed" || workingMission.status === "canceled" || workingMission.status === "completed") {
    return workingMission;
  }
  if (workingMission.toolRuns.length >= MAX_STEPS_PER_MISSION) {
    return {
      ...workingMission,
      status: "failed",
      lastError: `Mission step budget exceeded (${MAX_STEPS_PER_MISSION})`
    };
  }

  const runnable = getRunnableTasks(workingMission).slice(0, maxTasks ?? DEFAULT_MAX_TASKS);
  if (runnable.length === 0) {
    const withQa = await runRequiredQaIfNeeded(workingMission);
    if (withQa.status === "failed") {
      return withQa;
    }
    const hasCriticalFailure = withQa.tasks.some((task) => task.status === "failed" && !task.nonCritical);
    if (hasCriticalFailure) {
      return {
        ...withQa,
        status: "failed",
        lastError: withQa.lastError ?? "Critical mission task failed"
      };
    }
    const allTerminal = withQa.tasks.every((task) => ["done", "failed", "skipped"].includes(task.status));
    if (allTerminal) {
      return {
        ...withQa,
        status: "completed"
      };
    }
    return {
      ...withQa,
      status: "running"
    };
  }

  const snapshots = new Map<string, MissionTask>();
  for (const task of runnable) {
    snapshots.set(task.taskId, { ...task, outputsRefs: [...task.outputsRefs] });
  }

  const results: Array<{ taskId: string; mission: MissionRecord; hardFailure: boolean }> = [];
  let shouldHalt = false;

  await runWithConcurrency(runnable, Math.min(MAX_CONCURRENCY, maxTasks ?? DEFAULT_MAX_TASKS), async (task) => {
    if (shouldHalt) {
      return;
    }
    const snapshot = snapshots.get(task.taskId);
    if (!snapshot) {
      return;
    }
    const executed = await executeTask(workingMission, snapshot);
    results.push({
      taskId: snapshot.taskId,
      mission: executed.mission,
      hardFailure: executed.hardFailure
    });
    if (executed.hardFailure || executed.mission.status === "awaiting_approval" || executed.mission.status === "failed") {
      shouldHalt = true;
    }
  }, () => shouldHalt);

  for (const result of results) {
    workingMission = mergeMissionUpdate(workingMission, result.mission, result.taskId);
    if (result.hardFailure || workingMission.status === "awaiting_approval" || workingMission.status === "failed") {
      return workingMission;
    }
  }

  return {
    ...workingMission,
    status: "running"
  };
}
