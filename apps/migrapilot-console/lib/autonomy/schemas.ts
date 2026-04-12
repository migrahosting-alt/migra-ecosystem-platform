import type { ExecutionEnvironment } from "../shared/types";
import type {
  AutonomyConfig,
  Classification,
  Finding,
  AutonomyMissionQueueItem,
  ConfidenceState
} from "./types";

const ENV_SET = new Set<ExecutionEnvironment>(["dev", "stage", "staging", "prod", "test"]);

export const AutonomyConfigSchema = {
  type: "object",
  additionalProperties: false,
  required: ["enabled", "runnerPolicy", "environmentPolicy", "budgets", "confidenceGate"],
  properties: {
    enabled: { type: "boolean" },
    runnerPolicy: {
      type: "object",
      required: ["allowServer", "defaultRunnerTarget"],
      properties: {
        allowServer: { type: "boolean" },
        defaultRunnerTarget: { type: "string", enum: ["auto", "local", "server"] }
      }
    },
    environmentPolicy: {
      type: "object",
      required: ["defaultEnv", "prodAllowed"],
      properties: {
        defaultEnv: { type: "string", enum: ["dev", "stage", "staging", "prod", "test"] },
        prodAllowed: { type: "boolean" }
      }
    },
    budgets: {
      type: "object",
      required: [
        "missionsPerHour",
        "tier2PerDay",
        "maxWritesPerMission",
        "maxFailuresPerHour",
        "maxAffectedTenantsPerMission"
      ],
      properties: {
        missionsPerHour: { type: "integer", minimum: 1, maximum: 1000 },
        tier2PerDay: { type: "integer", minimum: 0, maximum: 10000 },
        maxWritesPerMission: { type: "integer", minimum: 0, maximum: 1000 },
        maxFailuresPerHour: { type: "integer", minimum: 1, maximum: 1000 },
        maxAffectedTenantsPerMission: { type: "integer", minimum: 1, maximum: 10000 }
      }
    },
    confidenceGate: {
      type: "object",
      required: ["minConfidenceToContinue", "decayOnFailure", "decayOnRetry"],
      properties: {
        minConfidenceToContinue: { type: "number", minimum: 0, maximum: 1 },
        decayOnFailure: { type: "number", minimum: 0, maximum: 1 },
        decayOnRetry: { type: "number", minimum: 0, maximum: 1 }
      }
    }
  }
} as const;

export const FindingSchema = {
  type: "object",
  additionalProperties: false,
  required: ["findingId", "ts", "source", "severity", "title", "details", "dedupeHash"],
  properties: {
    findingId: { type: "string" },
    ts: { type: "string" },
    source: { type: "string", enum: ["repo", "inventory", "health"] },
    severity: { type: "string", enum: ["info", "warn", "critical"] },
    title: { type: "string" },
    details: { type: "string" },
    classification: { type: "string", enum: ["internal", "client"] },
    tenantId: { type: "string" },
    suggestedMissionTemplateId: { type: "string" },
    dedupeHash: { type: "string" }
  }
} as const;

export const QueueItemSchema = {
  type: "object",
  additionalProperties: false,
  required: ["queueId", "findingId", "templateId", "status", "attempts", "createdAt", "updatedAt", "outputsRefs"],
  properties: {
    queueId: { type: "string" },
    findingId: { type: "string" },
    missionId: { type: "string" },
    templateId: { type: "string" },
    status: { type: "string", enum: ["queued", "running", "awaiting_approval", "done", "failed", "skipped"] },
    attempts: { type: "integer", minimum: 0 },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
    nextAttemptAt: { type: "string" },
    sourceClassification: { type: "string", enum: ["internal", "client"] },
    affectedTenants: { type: "array", items: { type: "string" } },
    processedRunIds: { type: "array", items: { type: "string" } },
    outputsRefs: { type: "array" },
    lastError: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string" },
        message: { type: "string" }
      }
    }
  }
} as const;

export const ConfidenceStateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["score", "lastUpdated", "recentFailures", "recentSuccesses"],
  properties: {
    score: { type: "number", minimum: 0, maximum: 1 },
    lastUpdated: { type: "string" },
    recentFailures: { type: "integer", minimum: 0 },
    recentSuccesses: { type: "integer", minimum: 0 }
  }
} as const;

export const DEFAULT_AUTONOMY_CONFIG: AutonomyConfig = {
  enabled: false,
  runnerPolicy: {
    allowServer: false,
    defaultRunnerTarget: "auto"
  },
  environmentPolicy: {
    defaultEnv: "dev",
    prodAllowed: false
  },
  budgets: {
    missionsPerHour: 6,
    tier2PerDay: 1,
    maxWritesPerMission: 3,
    maxFailuresPerHour: 4,
    maxAffectedTenantsPerMission: 2
  },
  confidenceGate: {
    minConfidenceToContinue: 0.7,
    decayOnFailure: 0.15,
    decayOnRetry: 0.05
  },
  proposeBeforeExecute: false,
  proposalWindowSecs: 120
};

export function isClassification(value: unknown): value is Classification {
  return value === "internal" || value === "client";
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function asEnv(value: unknown, fallback: ExecutionEnvironment): ExecutionEnvironment {
  if (typeof value === "string" && ENV_SET.has(value as ExecutionEnvironment)) {
    return value as ExecutionEnvironment;
  }
  return fallback;
}

function asRunnerTarget(value: unknown, fallback: AutonomyConfig["runnerPolicy"]["defaultRunnerTarget"]) {
  if (value === "auto" || value === "local" || value === "server") {
    return value;
  }
  return fallback;
}

export function normalizeAutonomyConfig(input: unknown): AutonomyConfig {
  const root = asObject(input);
  const runnerPolicy = asObject(root.runnerPolicy);
  const environmentPolicy = asObject(root.environmentPolicy);
  const budgets = asObject(root.budgets);
  const confidenceGate = asObject(root.confidenceGate);

  return {
    enabled: asBoolean(root.enabled, DEFAULT_AUTONOMY_CONFIG.enabled),
    runnerPolicy: {
      allowServer: asBoolean(runnerPolicy.allowServer, DEFAULT_AUTONOMY_CONFIG.runnerPolicy.allowServer),
      defaultRunnerTarget: asRunnerTarget(
        runnerPolicy.defaultRunnerTarget,
        DEFAULT_AUTONOMY_CONFIG.runnerPolicy.defaultRunnerTarget
      )
    },
    environmentPolicy: {
      defaultEnv: asEnv(environmentPolicy.defaultEnv, DEFAULT_AUTONOMY_CONFIG.environmentPolicy.defaultEnv),
      prodAllowed: asBoolean(environmentPolicy.prodAllowed, DEFAULT_AUTONOMY_CONFIG.environmentPolicy.prodAllowed)
    },
    budgets: {
      missionsPerHour: clamp(
        Math.trunc(asNumber(budgets.missionsPerHour, DEFAULT_AUTONOMY_CONFIG.budgets.missionsPerHour)),
        1,
        1000
      ),
      tier2PerDay: clamp(
        Math.trunc(asNumber(budgets.tier2PerDay, DEFAULT_AUTONOMY_CONFIG.budgets.tier2PerDay)),
        0,
        10000
      ),
      maxWritesPerMission: clamp(
        Math.trunc(asNumber(budgets.maxWritesPerMission, DEFAULT_AUTONOMY_CONFIG.budgets.maxWritesPerMission)),
        0,
        1000
      ),
      maxFailuresPerHour: clamp(
        Math.trunc(asNumber(budgets.maxFailuresPerHour, DEFAULT_AUTONOMY_CONFIG.budgets.maxFailuresPerHour)),
        1,
        1000
      ),
      maxAffectedTenantsPerMission: clamp(
        Math.trunc(
          asNumber(
            budgets.maxAffectedTenantsPerMission,
            DEFAULT_AUTONOMY_CONFIG.budgets.maxAffectedTenantsPerMission
          )
        ),
        1,
        10000
      )
    },
    confidenceGate: {
      minConfidenceToContinue: clamp(
        asNumber(confidenceGate.minConfidenceToContinue, DEFAULT_AUTONOMY_CONFIG.confidenceGate.minConfidenceToContinue),
        0,
        1
      ),
      decayOnFailure: clamp(
        asNumber(confidenceGate.decayOnFailure, DEFAULT_AUTONOMY_CONFIG.confidenceGate.decayOnFailure),
        0,
        1
      ),
      decayOnRetry: clamp(
        asNumber(confidenceGate.decayOnRetry, DEFAULT_AUTONOMY_CONFIG.confidenceGate.decayOnRetry),
        0,
        1
      )
    },
    proposeBeforeExecute: asBoolean(root.proposeBeforeExecute, DEFAULT_AUTONOMY_CONFIG.proposeBeforeExecute ?? false),
    proposalWindowSecs: clamp(
      Math.trunc(asNumber(root.proposalWindowSecs, DEFAULT_AUTONOMY_CONFIG.proposalWindowSecs ?? 120)),
      10,
      3600
    )
  };
}

export function normalizeFinding(input: unknown): Finding | null {
  const root = asObject(input);
  if (
    typeof root.findingId !== "string" ||
    typeof root.ts !== "string" ||
    typeof root.source !== "string" ||
    typeof root.severity !== "string" ||
    typeof root.title !== "string" ||
    typeof root.details !== "string" ||
    typeof root.dedupeHash !== "string"
  ) {
    return null;
  }
  if (!["repo", "inventory", "health"].includes(root.source)) {
    return null;
  }
  if (!["info", "warn", "critical"].includes(root.severity)) {
    return null;
  }
  const source = root.source as Finding["source"];
  const severity = root.severity as Finding["severity"];

  const finding: Finding = {
    findingId: root.findingId,
    ts: root.ts,
    source,
    severity,
    title: root.title,
    details: root.details,
    dedupeHash: root.dedupeHash
  };

  if (isClassification(root.classification)) {
    finding.classification = root.classification;
  }
  if (typeof root.tenantId === "string" && root.tenantId.trim()) {
    finding.tenantId = root.tenantId.trim();
  }
  if (typeof root.suggestedMissionTemplateId === "string" && root.suggestedMissionTemplateId.trim()) {
    finding.suggestedMissionTemplateId = root.suggestedMissionTemplateId.trim();
  }

  return finding;
}

export function normalizeQueueItem(input: unknown): AutonomyMissionQueueItem | null {
  const root = asObject(input);
  if (
    typeof root.queueId !== "string" ||
    typeof root.findingId !== "string" ||
    typeof root.templateId !== "string" ||
    typeof root.status !== "string" ||
    typeof root.attempts !== "number" ||
    typeof root.createdAt !== "string" ||
    typeof root.updatedAt !== "string" ||
    !Array.isArray(root.outputsRefs)
  ) {
    return null;
  }

  if (!["queued", "running", "awaiting_approval", "done", "failed", "skipped"].includes(root.status)) {
    return null;
  }
  const status = root.status as AutonomyMissionQueueItem["status"];

  const item: AutonomyMissionQueueItem = {
    queueId: root.queueId,
    findingId: root.findingId,
    templateId: root.templateId,
    status,
    attempts: Math.max(0, Math.trunc(root.attempts)),
    createdAt: root.createdAt,
    updatedAt: root.updatedAt,
    outputsRefs: []
  };

  if (typeof root.missionId === "string" && root.missionId.trim()) {
    item.missionId = root.missionId.trim();
  }
  if (typeof root.nextAttemptAt === "string") {
    item.nextAttemptAt = root.nextAttemptAt;
  }
  if (isClassification(root.sourceClassification)) {
    item.sourceClassification = root.sourceClassification;
  }
  if (Array.isArray(root.affectedTenants)) {
    item.affectedTenants = root.affectedTenants.filter((entry): entry is string => typeof entry === "string");
  }
  if (Array.isArray(root.processedRunIds)) {
    item.processedRunIds = root.processedRunIds.filter((entry): entry is string => typeof entry === "string");
  }

  if (root.lastError && typeof root.lastError === "object" && !Array.isArray(root.lastError)) {
    const err = root.lastError as Record<string, unknown>;
    if (typeof err.code === "string" && typeof err.message === "string") {
      item.lastError = { code: err.code, message: err.message };
    }
  }

  item.outputsRefs = root.outputsRefs
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }
      const ref = entry as Record<string, unknown>;
      if (typeof ref.toolName !== "string" || typeof ref.runId !== "string") {
        return null;
      }
      return {
        toolName: ref.toolName,
        runId: ref.runId,
        jobId: typeof ref.jobId === "string" ? ref.jobId : undefined,
        journalEntryId: typeof ref.journalEntryId === "string" ? ref.journalEntryId : undefined
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  return item;
}

export function normalizeConfidenceState(input: unknown): ConfidenceState {
  const root = asObject(input);
  const now = new Date().toISOString();
  return {
    score: clamp(asNumber(root.score, 1), 0, 1),
    lastUpdated: typeof root.lastUpdated === "string" ? root.lastUpdated : now,
    recentFailures: Math.max(0, Math.trunc(asNumber(root.recentFailures, 0))),
    recentSuccesses: Math.max(0, Math.trunc(asNumber(root.recentSuccesses, 0)))
  };
}
