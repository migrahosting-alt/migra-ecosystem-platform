import { randomUUID } from "node:crypto";

import type { MissionRecord, MissionRunRecord } from "../mission/types";
import { applyConfidenceFailure, applyConfidenceRetry, applyConfidenceSuccess, confidenceGateTripped } from "./confidence";
import { createFinding } from "./finding";
import { getMissionViaApi, startMissionViaApi, stepMissionViaApi } from "./mission-api";
import { trimAutonomyState, updateAutonomyState } from "./store";
import { TEMPLATE_INVESTIGATE_FAILURE, templateFromFinding } from "./templates";
import { autonomyObservers } from "./observers";
import { buildAnalysisFromFinding } from "../mission/reasoning";
import { emitConfidenceChanged } from "../activity/store";
import type {
  AutonomyMissionQueueItem,
  AutonomyRunOnceResult,
  AutonomyState,
  AutonomyStatusView,
  BudgetsUsage,
  Finding,
  QueueCounts
} from "./types";

const DEDUPE_WINDOW_MS = 10 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const RETRY_BACKOFF_MS = 30 * 1000;
const MAX_MISSION_STEPS_PER_CYCLE = 2;
const QUEUE_CONCURRENCY = 2;

let cycleRunning = false;

/** When AUTONOMY_SMOKE_MODE=1: no intervals, single-cycle, deterministic exit */
const SMOKE_MODE = process.env.AUTONOMY_SMOKE_MODE === "1";

function toMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nowIso(): string {
  return new Date().toISOString();
}

function pruneRecent(timestamps: string[], windowMs: number, now: number): string[] {
  return timestamps.filter((ts) => {
    const parsed = toMs(ts);
    return parsed > 0 && now - parsed <= windowMs;
  });
}

function isWriteTool(toolName: string): boolean {
  if (["repo.applyPatch", "git.commit", "git.push", "journal.append"].includes(toolName)) {
    return true;
  }
  return /^(deploy\.|dns\.|pods\.|storage\.)/.test(toolName);
}

function collectQueueCounts(queue: AutonomyState["queue"]): QueueCounts {
  const counts: QueueCounts = {
    queued: 0,
    running: 0,
    awaiting_approval: 0,
    done: 0,
    failed: 0,
    skipped: 0
  };
  for (const item of queue) {
    counts[item.status] += 1;
  }
  return counts;
}

function buildBudgetsUsage(state: AutonomyState, nowMs: number): BudgetsUsage {
  const missionStarts = pruneRecent(state.usage.missionStarts, ONE_HOUR_MS, nowMs);
  const tier2Runs = pruneRecent(state.usage.tier2Runs, ONE_DAY_MS, nowMs);
  const failures = pruneRecent(state.usage.failures, ONE_HOUR_MS, nowMs);
  return {
    missionsPerHour: {
      used: missionStarts.length,
      limit: state.config.budgets.missionsPerHour
    },
    tier2PerDay: {
      used: tier2Runs.length,
      limit: state.config.budgets.tier2PerDay
    },
    failuresPerHour: {
      used: failures.length,
      limit: state.config.budgets.maxFailuresPerHour
    }
  };
}

export function buildAutonomyStatusView(state: AutonomyState): AutonomyStatusView {
  const nowMs = Date.now();
  return {
    enabled: state.config.enabled,
    confidence: state.confidence,
    budgetsUsage: buildBudgetsUsage(state, nowMs),
    queueCounts: collectQueueCounts(state.queue),
    lastRunTs: state.lastRunTs
  };
}

function dedupeFindings(state: AutonomyState, findings: Finding[], nowMs: number): Finding[] {
  const existing = new Map<string, number>();
  for (const entry of state.dedupe) {
    const ts = toMs(entry.ts);
    if (ts > 0) {
      existing.set(entry.hash, ts);
    }
  }

  const accepted: Finding[] = [];
  for (const finding of findings) {
    const previous = existing.get(finding.dedupeHash);
    if (previous && nowMs - previous <= DEDUPE_WINDOW_MS) {
      continue;
    }
    accepted.push(finding);
    existing.set(finding.dedupeHash, nowMs);
    state.dedupe.push({ hash: finding.dedupeHash, ts: finding.ts });
  }

  state.dedupe = state.dedupe.filter((entry) => {
    const ts = toMs(entry.ts);
    return ts > 0 && nowMs - ts <= ONE_DAY_MS;
  });

  if (accepted.length > 0) {
    state.findings.unshift(...accepted);
    state.findings = state.findings.slice(0, 500);
  }
  return accepted;
}

function pickOperator() {
  return {
    operatorId: process.env.MIGRAPILOT_AUTONOMY_OPERATOR_ID ?? "autonomy-system",
    role: process.env.MIGRAPILOT_AUTONOMY_OPERATOR_ROLE ?? "ops"
  };
}

function getFindingById(state: AutonomyState, findingId: string): Finding | null {
  return state.findings.find((item) => item.findingId === findingId) ?? null;
}

function enqueueFromFindings(state: AutonomyState, findings: Finding[]): number {
  let inserted = 0;
  for (const finding of findings) {
    if (!finding.suggestedMissionTemplateId) {
      continue;
    }
    const exists = state.queue.some((item) => item.findingId === finding.findingId);
    if (exists) {
      continue;
    }

    const queueItem: AutonomyMissionQueueItem = {
      queueId: `queue_${randomUUID()}`,
      findingId: finding.findingId,
      templateId: finding.suggestedMissionTemplateId,
      status: "queued",
      attempts: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      sourceClassification: finding.classification,
      affectedTenants: finding.tenantId ? [finding.tenantId] : undefined,
      outputsRefs: [],
      processedRunIds: []
    };
    state.queue.unshift(queueItem);
    inserted += 1;
  }
  state.queue = state.queue.slice(0, 500);
  return inserted;
}

function collectMissionRunDeltas(item: AutonomyMissionQueueItem, mission: MissionRecord): {
  newRefs: AutonomyMissionQueueItem["outputsRefs"];
  newTier2Runs: number;
  totalWrites: number;
  processedRunIds: string[];
} {
  const seen = new Set(item.processedRunIds ?? []);
  const refs = [...item.outputsRefs];
  let newTier2Runs = 0;
  let totalWrites = 0;

  for (const run of mission.toolRuns) {
    if (isWriteTool(run.toolName)) {
      totalWrites += 1;
    }
    if (seen.has(run.id)) {
      continue;
    }
    seen.add(run.id);
    if (run.effectiveTier >= 2) {
      newTier2Runs += 1;
    }
    refs.push({
      toolName: run.toolName,
      jobId: run.jobId,
      journalEntryId: run.journalEntryId,
      runId: run.runId
    });
  }

  return {
    newRefs: refs,
    newTier2Runs,
    totalWrites,
    processedRunIds: Array.from(seen)
  };
}

function missionAffectedTenants(mission: MissionRecord): string[] {
  const tenants = new Set<string>();
  let unknownCount = 0;
  for (const task of mission.tasks) {
    for (const call of task.toolCalls) {
      const input = call.input as Record<string, unknown>;
      if (typeof input.tenantId === "string" && input.tenantId.trim()) {
        tenants.add(input.tenantId.trim());
        continue;
      }
      const filter = input.filter;
      if (filter && typeof filter === "object" && !Array.isArray(filter)) {
        const tenantId = (filter as Record<string, unknown>).tenantId;
        if (typeof tenantId === "string" && tenantId.trim()) {
          tenants.add(tenantId.trim());
          continue;
        }
      }
      unknownCount += 1;
    }
  }

  if (unknownCount > 0 && tenants.size === 0) {
    tenants.add("unknown");
  }
  return Array.from(tenants);
}

async function processQueueItem(
  state: AutonomyState,
  item: AutonomyMissionQueueItem,
  nowMs: number
): Promise<{
  item: AutonomyMissionQueueItem;
  addedMissionStart: number;
  addedTier2Runs: number;
  addedFailure: number;
  recoveryFinding?: Finding;
  confidenceEvent: "success" | "retry" | "failure" | "none";
}> {
  const finding = getFindingById(state, item.findingId);
  if (!finding) {
    return {
      item: {
        ...item,
        status: "skipped",
        updatedAt: nowIso(),
        lastError: { code: "FINDING_NOT_FOUND", message: "Finding disappeared from store" }
      },
      addedMissionStart: 0,
      addedTier2Runs: 0,
      addedFailure: 0,
      confidenceEvent: "none"
    };
  }

  if (item.nextAttemptAt && toMs(item.nextAttemptAt) > nowMs) {
    return {
      item,
      addedMissionStart: 0,
      addedTier2Runs: 0,
      addedFailure: 0,
      confidenceEvent: "none"
    };
  }

  const template = templateFromFinding(finding, state.config);
  if (!template) {
    return {
      item: {
        ...item,
        status: "skipped",
        updatedAt: nowIso(),
        lastError: { code: "TEMPLATE_NOT_FOUND", message: `Template unavailable: ${item.templateId}` }
      },
      addedMissionStart: 0,
      addedTier2Runs: 0,
      addedFailure: 0,
      confidenceEvent: "none"
    };
  }

  if (template.runnerPolicy.default === "server" && !state.config.runnerPolicy.allowServer) {
    return {
      item: {
        ...item,
        status: "skipped",
        updatedAt: nowIso(),
        lastError: { code: "POLICY_VIOLATION", message: "Server runner is disabled by autonomy config" }
      },
      addedMissionStart: 0,
      addedTier2Runs: 0,
      addedFailure: 0,
      confidenceEvent: "none"
    };
  }

  let mission: MissionRecord;
  let addedMissionStart = 0;
  if (!item.missionId) {
    const analysis = buildAnalysisFromFinding({ finding });

    // Part F — Proposal behavior rules: force manual execution in high-risk scenarios
    let effectiveProposalWindowSecs = state.config.proposalWindowSecs ?? 120;
    if (state.config.proposeBeforeExecute) {
      // Critical severity with no identified root cause → always require manual execution
      if (finding.severity === "critical" && !analysis.likelyCause) {
        effectiveProposalWindowSecs = 0;
      }
      // Confidence below threshold → pause auto-countdown, require manual execution
      if (state.confidence.score < state.config.confidenceGate.minConfidenceToContinue) {
        effectiveProposalWindowSecs = 0;
      }
    }

    mission = await startMissionViaApi({
      goal: template.goal,
      context: {
        notes: template.context?.notes
      },
      runnerPolicy: template.runnerPolicy,
      environment: template.environment,
      operator: pickOperator(),
      origin: {
        source: "autonomy",
        findingId: finding.findingId,
        templateId: template.templateId
      },
      proposeBeforeExecute: state.config.proposeBeforeExecute ?? false,
      proposalWindowSecs: effectiveProposalWindowSecs,
      analysis
    });
    addedMissionStart = 1;

    const affectedTenants = missionAffectedTenants(mission);
    if (affectedTenants.length > state.config.budgets.maxAffectedTenantsPerMission) {
      return {
        item: {
          ...item,
          missionId: mission.missionId,
          status: "skipped",
          affectedTenants,
          updatedAt: nowIso(),
          lastError: {
            code: "BUDGET_EXCEEDED",
            message: `Affected tenants ${affectedTenants.length} exceed max ${state.config.budgets.maxAffectedTenantsPerMission}`
          }
        },
        addedMissionStart,
        addedTier2Runs: 0,
        addedFailure: 0,
        confidenceEvent: "none"
      };
    }

    item = {
      ...item,
      missionId: mission.missionId,
      affectedTenants,
      status: "running",
      updatedAt: nowIso(),
      nextAttemptAt: undefined
    };
  } else {
    mission = await getMissionViaApi(item.missionId);
    item = {
      ...item,
      status: mission.status === "awaiting_approval" ? "awaiting_approval" : "running",
      updatedAt: nowIso()
    };
  }

  let addedTier2Runs = 0;
  for (let i = 0; i < MAX_MISSION_STEPS_PER_CYCLE; i += 1) {
    if (mission.status === "completed") {
      const delta = collectMissionRunDeltas(item, mission);
      addedTier2Runs += delta.newTier2Runs;
      return {
        item: {
          ...item,
          status: "done",
          outputsRefs: delta.newRefs,
          processedRunIds: delta.processedRunIds,
          updatedAt: nowIso(),
          lastError: undefined
        },
        addedMissionStart,
        addedTier2Runs,
        addedFailure: 0,
        confidenceEvent: "success"
      };
    }

    if (mission.status === "awaiting_approval") {
      const delta = collectMissionRunDeltas(item, mission);
      addedTier2Runs += delta.newTier2Runs;
      return {
        item: {
          ...item,
          status: "awaiting_approval",
          outputsRefs: delta.newRefs,
          processedRunIds: delta.processedRunIds,
          updatedAt: nowIso()
        },
        addedMissionStart,
        addedTier2Runs,
        addedFailure: 0,
        confidenceEvent: "none"
      };
    }

    // Mission is still in the proposal window — hold the queue item; next cycle will check again
    if (mission.status === "proposed") {
      const delta = collectMissionRunDeltas(item, mission);
      addedTier2Runs += delta.newTier2Runs;
      return {
        item: {
          ...item,
          status: "running",
          outputsRefs: delta.newRefs,
          processedRunIds: delta.processedRunIds,
          updatedAt: nowIso()
        },
        addedMissionStart,
        addedTier2Runs,
        addedFailure: 0,
        confidenceEvent: "none"
      };
    }

    if (mission.status === "failed" || mission.status === "canceled") {
      if (item.attempts < 1) {
        return {
          item: {
            ...item,
            status: "queued",
            attempts: item.attempts + 1,
            updatedAt: nowIso(),
            nextAttemptAt: new Date(nowMs + RETRY_BACKOFF_MS).toISOString(),
            lastError: {
              code: "MISSION_FAILED",
              message: mission.lastError ?? "Mission failed"
            }
          },
          addedMissionStart,
          addedTier2Runs,
          addedFailure: 0,
          confidenceEvent: "retry"
        };
      }

      const recoveryFinding = createFinding({
        source: finding.source,
        severity: "warn",
        title: `Recovery needed for mission ${mission.missionId}`,
        details: mission.lastError ?? "Mission failed after retry",
        classification: finding.classification,
        tenantId: finding.tenantId,
        suggestedMissionTemplateId: TEMPLATE_INVESTIGATE_FAILURE
      });

      return {
        item: {
          ...item,
          status: "failed",
          updatedAt: nowIso(),
          lastError: {
            code: "MISSION_FAILED",
            message: mission.lastError ?? "Mission failed"
          }
        },
        addedMissionStart,
        addedTier2Runs,
        addedFailure: 1,
        recoveryFinding,
        confidenceEvent: "failure"
      };
    }

    mission = await stepMissionViaApi({
      missionId: mission.missionId,
      maxTasks: 2
    });

    const delta = collectMissionRunDeltas(item, mission);
    item = {
      ...item,
      outputsRefs: delta.newRefs,
      processedRunIds: delta.processedRunIds,
      updatedAt: nowIso()
    };
    addedTier2Runs += delta.newTier2Runs;

    if (delta.totalWrites > state.config.budgets.maxWritesPerMission) {
      return {
        item: {
          ...item,
          status: "failed",
          updatedAt: nowIso(),
          lastError: {
            code: "BUDGET_EXCEEDED",
            message: `Write budget exceeded (${delta.totalWrites}/${state.config.budgets.maxWritesPerMission})`
          }
        },
        addedMissionStart,
        addedTier2Runs,
        addedFailure: 1,
        confidenceEvent: "failure"
      };
    }
  }

  return {
    item: {
      ...item,
      status: "running",
      updatedAt: nowIso(),
      lastError: {
        code: "STEP_BUDGET_REACHED",
        message: "Mission step budget reached for this cycle"
      }
    },
    addedMissionStart,
    addedTier2Runs,
    addedFailure: 0,
    confidenceEvent: "none"
  };
}

function applyUsagePruning(state: AutonomyState, nowMs: number): void {
  state.usage.missionStarts = pruneRecent(state.usage.missionStarts, ONE_HOUR_MS, nowMs);
  state.usage.tier2Runs = pruneRecent(state.usage.tier2Runs, ONE_DAY_MS, nowMs);
  state.usage.failures = pruneRecent(state.usage.failures, ONE_HOUR_MS, nowMs);
}

function updateConfidenceForEvent(
  state: AutonomyState,
  event: "success" | "retry" | "failure" | "none"
): void {
  if (event === "success") {
    state.confidence = applyConfidenceSuccess(state.confidence);
    return;
  }
  if (event === "retry") {
    state.confidence = applyConfidenceRetry(state.confidence, state.config);
    return;
  }
  if (event === "failure") {
    state.confidence = applyConfidenceFailure(state.confidence, state.config);
  }
}

export async function runAutonomyCycle(input?: { seedFindings?: Finding[] }): Promise<AutonomyRunOnceResult> {
  if (cycleRunning) {
    const state = updateAutonomyState((current) => current);
    return {
      cycleStartedAt: nowIso(),
      cycleFinishedAt: nowIso(),
      insertedFindings: 0,
      enqueuedItems: 0,
      processedItems: 0,
      pausedByConfidenceGate: false,
      pausedByCircuitBreaker: false,
      status: buildAutonomyStatusView(state)
    };
  }

  cycleRunning = true;
  const cycleStart = nowIso();
  try {
    let insertedFindings = 0;
    let enqueuedItems = 0;
    let processedItems = 0;
    let pausedByConfidenceGate = false;
    let pausedByCircuitBreaker = false;

    const state = updateAutonomyState((current) => {
      const next = { ...current, findings: [...current.findings], queue: [...current.queue], dedupe: [...current.dedupe], usage: {
        missionStarts: [...current.usage.missionStarts],
        tier2Runs: [...current.usage.tier2Runs],
        failures: [...current.usage.failures]
      } };

      const nowMs = Date.now();
      applyUsagePruning(next, nowMs);
      next.lastRunTs = cycleStart;

      const observations: Finding[] = [];
      return next;
    });

    if (!state.config.enabled) {
      const updated = updateAutonomyState((current) => ({ ...current, lastRunTs: cycleStart }));
      return {
        cycleStartedAt: cycleStart,
        cycleFinishedAt: nowIso(),
        insertedFindings: 0,
        enqueuedItems: 0,
        processedItems: 0,
        pausedByConfidenceGate: false,
        pausedByCircuitBreaker: false,
        status: buildAutonomyStatusView(updated)
      };
    }

    const observerFindings: Finding[] = [];
    const observerContext = {
      config: state.config,
      now: new Date()
    };

    for (const observer of autonomyObservers) {
      try {
        const produced = await observer(observerContext);
        observerFindings.push(...produced);
      } catch (error) {
        observerFindings.push(
          createFinding({
            source: "health",
            severity: "warn",
            title: "Observer execution failure",
            details: (error as Error).message,
            suggestedMissionTemplateId: TEMPLATE_INVESTIGATE_FAILURE
          })
        );
      }
    }

    const seeded = input?.seedFindings ?? [];
    const normalizedSeeded = seeded.map((finding) => ({
      ...finding,
      ts: finding.ts || nowIso()
    }));

    let working = updateAutonomyState((current) => {
      const next: AutonomyState = {
        ...current,
        findings: [...current.findings],
        queue: current.queue.map((item) => ({ ...item, outputsRefs: [...item.outputsRefs], processedRunIds: [...(item.processedRunIds ?? [])] })),
        usage: {
          missionStarts: [...current.usage.missionStarts],
          tier2Runs: [...current.usage.tier2Runs],
          failures: [...current.usage.failures]
        },
        dedupe: [...current.dedupe]
      };
      const nowMs = Date.now();
      applyUsagePruning(next, nowMs);
      const accepted = dedupeFindings(next, [...observerFindings, ...normalizedSeeded], nowMs);
      insertedFindings = accepted.length;
      enqueuedItems = enqueueFromFindings(next, accepted);
      next.lastRunTs = cycleStart;
      return trimAutonomyState(next);
    });

    const nowMs = Date.now();
    applyUsagePruning(working, nowMs);
    let budgets = buildBudgetsUsage(working, nowMs);

    if (budgets.tier2PerDay.used >= working.config.budgets.tier2PerDay && working.config.budgets.tier2PerDay >= 0) {
      working = updateAutonomyState((current) => {
        const next = {
          ...current,
          config: {
            ...current.config,
            enabled: false
          },
          findings: [...current.findings]
        };
        next.findings.unshift(
          createFinding({
            source: "health",
            severity: "critical",
            title: "Tier 2 budget gate blocked autonomy",
            details: `tier2/day budget reached (${budgets.tier2PerDay.used}/${current.config.budgets.tier2PerDay})`,
            suggestedMissionTemplateId: TEMPLATE_INVESTIGATE_FAILURE
          })
        );
        return trimAutonomyState(next);
      });
      pausedByCircuitBreaker = true;
      return {
        cycleStartedAt: cycleStart,
        cycleFinishedAt: nowIso(),
        insertedFindings,
        enqueuedItems,
        processedItems: 0,
        pausedByConfidenceGate: false,
        pausedByCircuitBreaker: true,
        status: buildAutonomyStatusView(working)
      };
    }

    const candidates = working.queue
      .filter((item) => {
        if (item.status === "queued" || item.status === "running") {
          if (item.nextAttemptAt && toMs(item.nextAttemptAt) > nowMs) {
            return false;
          }
          return true;
        }
        return false;
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    const runnable: AutonomyMissionQueueItem[] = [];
    let availableMissionStarts = Math.max(0, working.config.budgets.missionsPerHour - budgets.missionsPerHour.used);

    for (const candidate of candidates) {
      if (runnable.length >= QUEUE_CONCURRENCY) {
        break;
      }
      if (!candidate.missionId) {
        if (availableMissionStarts <= 0) {
          continue;
        }
        availableMissionStarts -= 1;
      }
      runnable.push(candidate);
    }

    const processed = await Promise.all(
      runnable.map((item) => processQueueItem(working, item, nowMs))
    );

    processedItems = processed.length;
    // Capture confidence before the cycle state update to compute delta for activity events
    const prevConfidenceScore = working.confidence.score;
    working = updateAutonomyState((current) => {
      const next: AutonomyState = {
        ...current,
        findings: [...current.findings],
        queue: current.queue.map((item) => ({ ...item, outputsRefs: [...item.outputsRefs], processedRunIds: [...(item.processedRunIds ?? [])] })),
        usage: {
          missionStarts: [...current.usage.missionStarts],
          tier2Runs: [...current.usage.tier2Runs],
          failures: [...current.usage.failures]
        },
        dedupe: [...current.dedupe]
      };

      const queueById = new Map(next.queue.map((item) => [item.queueId, item]));

      for (const result of processed) {
        const existing = queueById.get(result.item.queueId);
        if (!existing) {
          continue;
        }
        queueById.set(result.item.queueId, {
          ...existing,
          ...result.item,
          outputsRefs: [...result.item.outputsRefs],
          processedRunIds: [...(result.item.processedRunIds ?? [])]
        });

        for (let i = 0; i < result.addedMissionStart; i += 1) {
          next.usage.missionStarts.push(nowIso());
        }
        for (let i = 0; i < result.addedTier2Runs; i += 1) {
          next.usage.tier2Runs.push(nowIso());
        }
        for (let i = 0; i < result.addedFailure; i += 1) {
          next.usage.failures.push(nowIso());
        }

        updateConfidenceForEvent(next, result.confidenceEvent);

        if (result.recoveryFinding) {
          const accepted = dedupeFindings(next, [result.recoveryFinding], Date.now());
          enqueueFromFindings(next, accepted);
        }
      }

      next.queue = Array.from(queueById.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      applyUsagePruning(next, Date.now());
      const usage = buildBudgetsUsage(next, Date.now());
      if (usage.failuresPerHour.used > next.config.budgets.maxFailuresPerHour) {
        next.config = {
          ...next.config,
          enabled: false
        };
        next.findings.unshift(
          createFinding({
            source: "health",
            severity: "critical",
            title: "Autonomy circuit breaker engaged",
            details: `Failures in last hour (${usage.failuresPerHour.used}) exceeded cap ${next.config.budgets.maxFailuresPerHour}`,
            suggestedMissionTemplateId: TEMPLATE_INVESTIGATE_FAILURE
          })
        );
        pausedByCircuitBreaker = true;
      }

      if (confidenceGateTripped(next.confidence, next.config)) {
        next.config = {
          ...next.config,
          enabled: false
        };
        next.findings.unshift(
          createFinding({
            source: "health",
            severity: "critical",
            title: "Confidence gate tripped",
            details: `Confidence ${next.confidence.score.toFixed(2)} below threshold ${next.config.confidenceGate.minConfidenceToContinue}`,
            suggestedMissionTemplateId: TEMPLATE_INVESTIGATE_FAILURE
          })
        );
        pausedByConfidenceGate = true;
      }

      next.lastRunTs = nowIso();
      return trimAutonomyState(next);
    });

    budgets = buildBudgetsUsage(working, Date.now());

    // Fire confidence change events to the activity feed
    for (const result of processed) {
      if (result.confidenceEvent !== "none") {
        emitConfidenceChanged({
          score: working.confidence.score,
          prevScore: prevConfidenceScore,
          reason:
            result.confidenceEvent === "failure"
              ? "failure decay"
              : result.confidenceEvent === "retry"
                ? "retry decay"
                : "success"
        });
      }
    }

    if (budgets.tier2PerDay.used > working.config.budgets.tier2PerDay) {
      working = updateAutonomyState((current) => {
        const next = {
          ...current,
          config: {
            ...current.config,
            enabled: false
          },
          findings: [...current.findings]
        };
        next.findings.unshift(
          createFinding({
            source: "health",
            severity: "critical",
            title: "Tier 2 daily budget exceeded",
            details: `Tier2 runs ${budgets.tier2PerDay.used}/${current.config.budgets.tier2PerDay}`,
            suggestedMissionTemplateId: TEMPLATE_INVESTIGATE_FAILURE
          })
        );
        return trimAutonomyState(next);
      });
      pausedByCircuitBreaker = true;
    }

    return {
      cycleStartedAt: cycleStart,
      cycleFinishedAt: nowIso(),
      insertedFindings,
      enqueuedItems,
      processedItems,
      pausedByConfidenceGate,
      pausedByCircuitBreaker,
      status: buildAutonomyStatusView(working)
    };
  } finally {
    cycleRunning = false;
  }
}

export function collectAutonomyMissionRefs(mission: MissionRecord): Array<{
  toolName: string;
  jobId?: string;
  journalEntryId?: string;
  runId: string;
}> {
  return mission.toolRuns.map((run: MissionRunRecord) => ({
    toolName: run.toolName,
    jobId: run.jobId,
    journalEntryId: run.journalEntryId,
    runId: run.runId
  }));
}
