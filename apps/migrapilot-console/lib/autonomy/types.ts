import type { ExecutionEnvironment } from "../shared/types";

export type Classification = "internal" | "client";
export type AutonomyRunnerTarget = "auto" | "local" | "server";

export interface AutonomyConfig {
  enabled: boolean;
  runnerPolicy: {
    allowServer: boolean;
    defaultRunnerTarget: AutonomyRunnerTarget;
  };
  environmentPolicy: {
    defaultEnv: ExecutionEnvironment;
    prodAllowed: boolean;
  };
  budgets: {
    missionsPerHour: number;
    tier2PerDay: number;
    maxWritesPerMission: number;
    maxFailuresPerHour: number;
    maxAffectedTenantsPerMission: number;
  };
  confidenceGate: {
    minConfidenceToContinue: number;
    decayOnFailure: number;
    decayOnRetry: number;
  };
  /** When true, autonomy-started missions are proposed (status="proposed") rather than immediately pending */
  proposeBeforeExecute?: boolean;
  /** Proposal window in seconds before auto-confirm (default 120) */
  proposalWindowSecs?: number;
}

export interface Finding {
  findingId: string;
  ts: string;
  source: "repo" | "inventory" | "health";
  severity: "info" | "warn" | "critical";
  title: string;
  details: string;
  classification?: Classification;
  tenantId?: string;
  suggestedMissionTemplateId?: string;
  dedupeHash: string;
}

export interface QueueError {
  code: string;
  message: string;
}

export interface AutonomyMissionQueueItem {
  queueId: string;
  findingId: string;
  missionId?: string;
  templateId: string;
  status: "queued" | "running" | "awaiting_approval" | "done" | "failed" | "skipped";
  attempts: number;
  createdAt: string;
  updatedAt: string;
  nextAttemptAt?: string;
  lastError?: QueueError;
  sourceClassification?: Classification;
  affectedTenants?: string[];
  processedRunIds?: string[];
  outputsRefs: Array<{
    toolName: string;
    jobId?: string;
    journalEntryId?: string;
    runId: string;
  }>;
}

export interface ConfidenceState {
  score: number;
  lastUpdated: string;
  recentFailures: number;
  recentSuccesses: number;
}

export interface AutonomyUsageHistory {
  missionStarts: string[];
  tier2Runs: string[];
  failures: string[];
}

export interface AutonomyState {
  config: AutonomyConfig;
  findings: Finding[];
  queue: AutonomyMissionQueueItem[];
  confidence: ConfidenceState;
  usage: AutonomyUsageHistory;
  dedupe: Array<{ hash: string; ts: string }>;
  lastRunTs?: string;
}

export interface BudgetsUsage {
  missionsPerHour: { used: number; limit: number };
  tier2PerDay: { used: number; limit: number };
  failuresPerHour: { used: number; limit: number };
}

export interface QueueCounts {
  queued: number;
  running: number;
  awaiting_approval: number;
  done: number;
  failed: number;
  skipped: number;
}

export interface AutonomyStatusView {
  enabled: boolean;
  confidence: ConfidenceState;
  budgetsUsage: BudgetsUsage;
  queueCounts: QueueCounts;
  lastRunTs?: string;
}

export interface AutonomyRunOnceResult {
  cycleStartedAt: string;
  cycleFinishedAt: string;
  insertedFindings: number;
  enqueuedItems: number;
  processedItems: number;
  pausedByConfidenceGate: boolean;
  pausedByCircuitBreaker: boolean;
  status: AutonomyStatusView;
}

export interface ObserverContext {
  config: AutonomyConfig;
  now: Date;
}

export type ObserverFn = (context: ObserverContext) => Promise<Finding[]>;

export interface MissionTemplateResult {
  templateId: string;
  goal: string;
  context?: {
    notes?: string;
  };
  runnerPolicy: {
    default: AutonomyRunnerTarget;
    allowServer: boolean;
  };
  environment: ExecutionEnvironment;
  constraints: {
    maxWrites: number;
    maxAffectedTenants: number;
  };
}
