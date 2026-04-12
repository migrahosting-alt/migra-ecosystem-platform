import type { MissionTask, MissionTaskGraph, MissionToolCall } from "./types";

export const MissionToolCallSchema = {
  type: "object",
  additionalProperties: false,
  required: ["toolName", "input"],
  properties: {
    toolName: { type: "string", minLength: 1 },
    input: { type: "object" },
    runnerTarget: { type: "string", enum: ["local", "server"] },
    environment: { type: "string", enum: ["dev", "stage", "staging", "prod", "test"] },
    nonCritical: { type: "boolean" }
  }
} as const;

export const MissionTaskSchema = {
  type: "object",
  additionalProperties: false,
  required: ["taskId", "lane", "title", "intent", "deps", "toolCalls", "status", "retries", "maxRetries", "outputsRefs"],
  properties: {
    taskId: { type: "string", minLength: 1 },
    lane: { type: "string", enum: ["code", "qa", "ops", "docs"] },
    title: { type: "string", minLength: 1 },
    intent: { type: "string", minLength: 1 },
    deps: { type: "array", items: { type: "string" } },
    toolCalls: { type: "array" },
    status: { type: "string", enum: ["pending", "running", "done", "failed", "awaiting_approval", "skipped"] },
    retries: { type: "integer", minimum: 0 },
    maxRetries: { type: "integer", minimum: 0, maximum: 5 },
    nonCritical: { type: "boolean" },
    outputsRefs: { type: "array" },
    lastError: { type: "string" }
  }
} as const;

export const MissionTaskGraphSchema = {
  type: "object",
  additionalProperties: false,
  required: ["lanes", "tasks"],
  properties: {
    lanes: {
      type: "array",
      items: { type: "string", enum: ["code", "qa", "ops", "docs"] },
      minItems: 1
    },
    tasks: { type: "array", minItems: 1 }
  }
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateToolCall(value: unknown): value is MissionToolCall {
  if (!isRecord(value)) {
    return false;
  }
  if (typeof value.toolName !== "string" || value.toolName.length === 0) {
    return false;
  }
  if (!isRecord(value.input)) {
    return false;
  }
  if (value.runnerTarget && value.runnerTarget !== "local" && value.runnerTarget !== "server") {
    return false;
  }
  if (
    value.environment &&
    value.environment !== "dev" &&
    value.environment !== "stage" &&
    value.environment !== "staging" &&
    value.environment !== "prod" &&
    value.environment !== "test"
  ) {
    return false;
  }
  if (value.nonCritical !== undefined && typeof value.nonCritical !== "boolean") {
    return false;
  }
  return true;
}

function validateTask(value: unknown): value is MissionTask {
  if (!isRecord(value)) {
    return false;
  }
  if (typeof value.taskId !== "string" || !value.taskId) {
    return false;
  }
  if (!["code", "qa", "ops", "docs"].includes(String(value.lane))) {
    return false;
  }
  if (typeof value.title !== "string" || !value.title) {
    return false;
  }
  if (typeof value.intent !== "string" || !value.intent) {
    return false;
  }
  if (!Array.isArray(value.deps) || !value.deps.every((dep) => typeof dep === "string")) {
    return false;
  }
  if (!Array.isArray(value.toolCalls) || !value.toolCalls.every((call) => validateToolCall(call))) {
    return false;
  }
  if (![
    "pending",
    "running",
    "done",
    "failed",
    "awaiting_approval",
    "skipped"
  ].includes(String(value.status))) {
    return false;
  }
  if (typeof value.retries !== "number" || typeof value.maxRetries !== "number") {
    return false;
  }
  if (!Array.isArray(value.outputsRefs)) {
    return false;
  }
  return true;
}

export function validateTaskGraph(value: unknown): value is MissionTaskGraph {
  if (!isRecord(value)) {
    return false;
  }
  if (!Array.isArray(value.lanes) || value.lanes.length === 0) {
    return false;
  }
  if (!value.lanes.every((lane) => ["code", "qa", "ops", "docs"].includes(String(lane)))) {
    return false;
  }
  if (!Array.isArray(value.tasks) || value.tasks.length === 0) {
    return false;
  }
  if (!value.tasks.every((task) => validateTask(task))) {
    return false;
  }

  const ids = new Set<string>();
  for (const task of value.tasks) {
    if (ids.has(task.taskId)) {
      return false;
    }
    ids.add(task.taskId);
  }
  for (const task of value.tasks) {
    if (!task.deps.every((dep) => ids.has(dep))) {
      return false;
    }
  }
  return true;
}
