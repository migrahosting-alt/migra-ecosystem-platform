import type { ArtifactReference } from "../server/artifact-storage";

export type MissionLane = "code" | "qa" | "ops" | "docs";
export type MissionStatus =
  | "proposed"
  | "pending"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "canceled";

export interface MissionAnalysis {
  detectedFrom: "drift" | "finding" | "observer" | "chat" | "manual";
  impact: {
    tenants: string[];
    domains: string[];
    pods: string[];
    services: string[];
  };
  riskLevel: "info" | "warn" | "critical";
  confidence: number;
  recommendation: string;
  proposedSteps: string[];
  correlationSummary?: string;
  findingId?: string;
  likelyCause?: string;
}
export type MissionTaskStatus =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "awaiting_approval"
  | "skipped";

export interface MissionOperator {
  operatorId: string;
  role: string;
  claims?: Record<string, unknown>;
}

export interface MissionRunnerPolicy {
  default: "auto" | "local" | "server";
  allowServer?: boolean;
}

export interface MissionOrigin {
  source: "manual" | "autonomy";
  findingId?: string;
  templateId?: string;
}

export interface MissionToolCall {
  toolName: string;
  input: Record<string, unknown>;
  runnerTarget?: "local" | "server";
  environment?: "dev" | "stage" | "staging" | "prod" | "test";
  nonCritical?: boolean;
}

export interface MissionOutputRef {
  jobId?: string;
  journalEntryId?: string;
  toolName: string;
  runId: string;
}

export interface MissionTask {
  taskId: string;
  lane: MissionLane;
  title: string;
  intent: string;
  deps: string[];
  toolCalls: MissionToolCall[];
  status: MissionTaskStatus;
  retries: number;
  maxRetries: number;
  nonCritical?: boolean;
  outputsRefs: MissionOutputRef[];
  lastError?: string;
}

export interface MissionTaskGraph {
  lanes: MissionLane[];
  tasks: MissionTask[];
}

export interface MissionRunRecord {
  id: string;
  missionId: string;
  taskId: string;
  toolName: string;
  runnerUsed: "local" | "server";
  env: "dev" | "stage" | "staging" | "prod" | "test";
  baseTier: number;
  effectiveTier: number;
  jobId?: string;
  journalEntryId?: string;
  ok: boolean;
  errorCode?: string;
  runId: string;
  createdAt: string;
}

export interface MissionApprovalRef {
  approvalId: string;
  missionId: string;
  taskId: string;
  toolName: string;
  riskSummary: string;
  requestedAt: string;
}

export interface MissionRecord {
  missionId: string;
  createdAt: string;
  updatedAt: string;
  goal: string;
  context?: {
    repoRoot?: string;
    notes?: string;
    focusFile?: string;
    patch?: string;
  };
  operator: MissionOperator;
  environment: "dev" | "stage" | "staging" | "prod" | "test";
  runnerPolicy: MissionRunnerPolicy;
  runIdBase: string;
  status: MissionStatus;
  planner: "rule" | "llm";
  origin?: MissionOrigin;
  tasks: MissionTask[];
  toolRuns: MissionRunRecord[];
  pendingApproval?: MissionApprovalRef;
  lastError?: string;
  notes: string[];
  analysis?: MissionAnalysis;
  proposedAt?: string;
  proposalExpiresAt?: string;
  dryRun?: boolean;
}

export interface StartMissionInput {
  goal: string;
  context?: MissionRecord["context"];
  runnerPolicy?: MissionRunnerPolicy;
  environment: MissionRecord["environment"];
  operator: MissionOperator;
  origin?: MissionOrigin;
  proposeBeforeExecute?: boolean;
  analysis?: MissionAnalysis;
  proposalWindowSecs?: number;
}

export interface StepMissionInput {
  missionId: string;
  maxTasks?: number;
}

export interface MissionProgressView {
  missionId: string;
  status: MissionStatus;
  currentTasks: Array<{
    taskId: string;
    lane: MissionLane;
    title: string;
    status: MissionTaskStatus;
  }>;
  completedTasks: number;
  pendingApproval?: MissionApprovalRef;
  lastError?: string;
}

export interface MissionReport {
  missionId: string;
  status: MissionStatus;
  summary: string;
  tasks: Array<{
    taskId: string;
    lane: MissionLane;
    title: string;
    status: MissionTaskStatus;
    retries: number;
  }>;
  changedFiles: string[];
  verification: {
    qaPassed: boolean;
    checks: string[];
  };
  journalEntryIds: string[];
  nextActions: string[];
  markdown: string;
  artifacts?: {
    generatedAt: string;
    json?: ArtifactReference | null;
    markdown?: ArtifactReference | null;
  } | null;
}

export interface PlannerInput {
  goal: string;
  context?: MissionRecord["context"];
  environment: MissionRecord["environment"];
  operator: MissionOperator;
  runnerPolicy: MissionRunnerPolicy;
}

export interface PlannerResult {
  planner: "rule" | "llm";
  taskGraph: MissionTaskGraph;
  notes: string[];
}
