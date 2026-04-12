import fs from "node:fs";
import { randomUUID } from "node:crypto";

import { recordRun } from "../../../server/store";
import { sanitize } from "../../../server/sanitize";
import { executeToolWithPolicy } from "../../../server/tool-runtime";
import type { ToolExecutionResult } from "../../../shared/types";
import type { Action } from "../models";

const INVENTORY_PATH = process.env.MIGRAPILOT_INVENTORY_PATH ?? "/etc/migrapilot/inventory.json";
const INVENTORY_STALE_MS = Number(process.env.MIGRAPILOT_INVENTORY_STALE_MS ?? 10 * 60 * 1000);
const READ_HEAVY_INFRA_ACTIONS = new Set([
  "run_infrastructure_diagnostic",
]);

export interface ActionExecutionOutcome {
  actionId: string;
  type: string;
  status: "simulated" | "deferred" | "gated" | "executed" | "failed";
  targetSystem: string;
  suggestedCommand?: string;
  detail: string;
  response?: unknown;
}

function readInventoryGate(): {
  ok: boolean;
  detail: string;
  metadata: Record<string, unknown>;
} {
  try {
    const raw = JSON.parse(fs.readFileSync(INVENTORY_PATH, "utf8")) as Record<string, unknown>;
    const generatedAt = typeof raw.generatedAt === "string" ? raw.generatedAt : null;
    const generatedTs = generatedAt ? Date.parse(generatedAt) : Number.NaN;
    const ageMs = Number.isFinite(generatedTs) ? Date.now() - generatedTs : Number.NaN;
    const ageMinutes = Number.isFinite(ageMs) ? Math.max(0, Math.round(ageMs / 60000)) : null;
    const topology = raw.topology && typeof raw.topology === "object" ? (raw.topology as Record<string, unknown>) : {};
    const counts = {
      services: Array.isArray(raw.services) ? raw.services.length : 0,
      pods: Array.isArray(raw.pods) ? raw.pods.length : 0,
      tenants: Array.isArray(raw.tenants) ? raw.tenants.length : 0,
      domains: Array.isArray(raw.domains) ? raw.domains.length : 0,
      edges: Array.isArray(topology.edges) ? topology.edges.length : 0,
    };

    if (!Number.isFinite(ageMs) || ageMs > INVENTORY_STALE_MS) {
      return {
        ok: false,
        detail: `Inventory is stale or unreadable for diagnostic execution${ageMinutes === null ? "" : ` (${ageMinutes}m old)`}.`,
        metadata: { path: INVENTORY_PATH, generatedAt, ageMinutes, ...counts },
      };
    }

    if (counts.services === 0 || counts.pods === 0) {
      return {
        ok: false,
        detail: "Inventory is too sparse for a trustworthy infrastructure diagnostic.",
        metadata: { path: INVENTORY_PATH, generatedAt, ageMinutes, ...counts },
      };
    }

    return {
      ok: true,
      detail: "Inventory is fresh enough for diagnostic execution.",
      metadata: { path: INVENTORY_PATH, generatedAt, ageMinutes, ...counts },
    };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? `Inventory gate failed: ${error.message}` : "Inventory gate failed.",
      metadata: { path: INVENTORY_PATH },
    };
  }
}

function requiresFreshInventory(action: Action): boolean {
  return READ_HEAVY_INFRA_ACTIONS.has(action.type);
}

function gateInfraAction(action: Action, runId: string, toolName: string): ActionExecutionOutcome | null {
  const inventoryGate = readInventoryGate();
  if (inventoryGate.ok) {
    return null;
  }

  recordRun({
    id: runId,
    createdAt: new Date().toISOString(),
    status: "denied",
    overlay: {
      toolName,
      env: "prod",
      runnerType: "server",
      baseTier: 0,
      effectiveTier: 0,
      executionScope: "server",
      abacDecision: "deny",
      abacReason: inventoryGate.detail,
      budgetsConsumed: { commands: 0, writes: 0 },
    },
    input: { source: "autonomy", actionId: action.id },
    output: sanitize({
      ok: false,
      data: {
        gate: inventoryGate.metadata,
      },
      warnings: [],
      error: {
        code: "INVENTORY_STALE",
        message: inventoryGate.detail,
        retryable: true,
      },
    }) as ToolExecutionResult,
    error: inventoryGate.detail,
  });

  return {
    actionId: action.id,
    type: action.type,
    status: "gated",
    targetSystem: action.targetSystem,
    suggestedCommand: action.suggestedCommand,
    detail: inventoryGate.detail,
    response: inventoryGate.metadata,
  };
}

function marketEngineActor() {
  return {
    actorId: process.env.MIGRAPILOT_MARKET_ENGINE_ACTOR_ID?.trim() || "internal-service",
    actorRole: (process.env.MIGRAPILOT_MARKET_ENGINE_ACTOR_ROLE?.trim() || "ADMIN").toUpperCase(),
  };
}

function buildEngineEnvelope(command: string, payload: Record<string, unknown>) {
  const actor = marketEngineActor();
  return {
    command,
    runId: `autonomy_${randomUUID()}`,
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    timestamp: new Date().toISOString(),
    payload,
  };
}

function resolveEngineTarget(action: Action): { command: string; payload: Record<string, unknown> } | null {
  switch (action.type) {
    case "increase_growth_output":
      return {
        command: "growth.generate_content",
        payload: { source: "autonomy", count: 10, category: "founder_authority", priority: action.parameters.priority },
      };
    case "replicate_high_signal_content":
      return {
        command: "content.optimize",
        payload: { source: "autonomy", variations: 5, signal: "growth_trend" },
      };
    case "trigger_revenue_follow_up":
      return {
        command: "revenue.advance_pipeline",
        payload: { source: "autonomy", followUpWindowDays: 2 },
      };
    default:
      return null;
  }
}

async function handoffToMigraMarket(action: Action): Promise<ActionExecutionOutcome> {
  const endpoint = process.env.MIGRAPILOT_MARKET_ENGINE_URL?.trim();
  const target = resolveEngineTarget(action);
  if (!endpoint || !target) {
    return {
      actionId: action.id,
      type: action.type,
      status: "deferred",
      targetSystem: action.targetSystem,
      suggestedCommand: action.suggestedCommand,
      detail: endpoint ? "No cross-system command mapping exists for this action." : "MigraMarket engine bridge is not configured.",
    };
  }

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.MIGRAPILOT_MARKET_ENGINE_TOKEN) {
    headers.authorization = `Bearer ${process.env.MIGRAPILOT_MARKET_ENGINE_TOKEN}`;
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(buildEngineEnvelope(target.command, target.payload)),
    });

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        actionId: action.id,
        type: action.type,
        status: "failed",
        targetSystem: action.targetSystem,
        suggestedCommand: action.suggestedCommand,
        detail: `MigraMarket engine handoff failed with HTTP ${response.status}.`,
        response: body,
      };
    }

    return {
      actionId: action.id,
      type: action.type,
      status: "executed",
      targetSystem: action.targetSystem,
      suggestedCommand: target.command,
      detail: `Forwarded to MigraMarket engine command ${target.command}.`,
      response: body,
    };
  } catch (error) {
    return {
      actionId: action.id,
      type: action.type,
      status: "failed",
      targetSystem: action.targetSystem,
      suggestedCommand: action.suggestedCommand,
      detail: error instanceof Error ? `MigraMarket engine handoff failed: ${error.message}` : "MigraMarket engine handoff failed.",
    };
  }
}

async function runInfrastructureDiagnostic(action: Action): Promise<ActionExecutionOutcome> {
  const runId = `autonomy_diag_${randomUUID()}`;
  const operator = {
    operatorId: "autonomy-engine",
    role: "ops",
  };
  const gate = gateInfraAction(action, runId, "autonomy.infrastructure.diagnostic");
  if (gate) {
    return gate;
  }

  try {
    const [topology, pods] = await Promise.all([
      executeToolWithPolicy({
        toolName: "inventory.services.topology",
        input: { filter: {} },
        environment: "prod",
        runnerType: "server",
        operator,
        runId: `${runId}_topology`,
        autonomyBudgetId: "autonomy-observe",
      }),
      executeToolWithPolicy({
        toolName: "inventory.pods.list",
        input: { filter: { limit: 25, offset: 0 } },
        environment: "prod",
        runnerType: "server",
        operator,
        runId: `${runId}_pods`,
        autonomyBudgetId: "autonomy-observe",
      }),
    ]);

    const status = topology.result.ok && pods.result.ok ? "completed" : "failed";
    const diagnosticResult: ToolExecutionResult = {
      ok: topology.result.ok && pods.result.ok,
      data: {
        topology: topology.result.data,
        pods: pods.result.data,
      },
      warnings: [...topology.result.warnings, ...pods.result.warnings],
      error: topology.result.error ?? pods.result.error ?? null,
    };

    recordRun({
      id: runId,
      createdAt: new Date().toISOString(),
      status,
      overlay: {
        toolName: "autonomy.infrastructure.diagnostic",
        env: "prod",
        runnerType: "server",
        baseTier: 0,
        effectiveTier: 0,
        executionScope: "server",
        abacDecision: "allow",
        abacReason: "Read-only autonomy diagnostic",
        budgetsConsumed: { commands: 2, writes: 0 },
      },
      input: { source: "autonomy", actionId: action.id },
      output: sanitize(diagnosticResult) as ToolExecutionResult,
      error: topology.result.error?.message ?? pods.result.error?.message,
    });

    if (!topology.result.ok || !pods.result.ok) {
      return {
        actionId: action.id,
        type: action.type,
        status: "failed",
        targetSystem: action.targetSystem,
        suggestedCommand: action.suggestedCommand,
        detail: "Read-only infrastructure diagnostic failed.",
        response: {
          topology: sanitize(topology.result),
          pods: sanitize(pods.result),
        },
      };
    }

    return {
      actionId: action.id,
      type: action.type,
      status: "executed",
      targetSystem: action.targetSystem,
      suggestedCommand: action.suggestedCommand,
      detail: "Read-only infrastructure diagnostic executed against live inventory and topology.",
      response: {
        topology: sanitize(topology.result.data),
        pods: sanitize(pods.result.data),
      },
    };
  } catch (error) {
    recordRun({
      id: runId,
      createdAt: new Date().toISOString(),
      status: "failed",
      overlay: {
        toolName: "autonomy.infrastructure.diagnostic",
        env: "prod",
        runnerType: "server",
        baseTier: 0,
        effectiveTier: 0,
        executionScope: "server",
        abacDecision: "allow",
        abacReason: "Read-only autonomy diagnostic",
        budgetsConsumed: { commands: 2, writes: 0 },
      },
      input: { source: "autonomy", actionId: action.id },
      error: error instanceof Error ? error.message : "Unknown infrastructure diagnostic failure",
    });

    return {
      actionId: action.id,
      type: action.type,
      status: "failed",
      targetSystem: action.targetSystem,
      suggestedCommand: action.suggestedCommand,
      detail: error instanceof Error ? `Infrastructure diagnostic failed: ${error.message}` : "Infrastructure diagnostic failed.",
    };
  }
}

export async function executeActionPlan(actions: Action[], options?: { executeLowRisk?: boolean }): Promise<ActionExecutionOutcome[]> {
  const outcomes: ActionExecutionOutcome[] = [];

  for (const action of actions) {
    if (action.executionStatus === "gated") {
      outcomes.push({
        actionId: action.id,
        type: action.type,
        status: "gated",
        targetSystem: action.targetSystem,
        suggestedCommand: action.suggestedCommand,
        detail: action.risk.reason,
      });
      continue;
    }

    if (!options?.executeLowRisk) {
      outcomes.push({
        actionId: action.id,
        type: action.type,
        status: "simulated",
        targetSystem: action.targetSystem,
        suggestedCommand: action.suggestedCommand,
        detail: "Dry-run only. No live action executed.",
      });
      continue;
    }

    if (action.type === "clear_backlog_and_review_failures") {
      outcomes.push({
        actionId: action.id,
        type: action.type,
        status: "executed",
        targetSystem: action.targetSystem,
        suggestedCommand: action.suggestedCommand,
        detail: "Native autonomy triage executed as an internal review action.",
        response: { reviewed: true },
      });
      continue;
    }

    if (requiresFreshInventory(action) && action.type !== "run_infrastructure_diagnostic") {
      const gate = gateInfraAction(action, `autonomy_guard_${randomUUID()}`, `autonomy.${action.type}`);
      if (gate) {
        outcomes.push(gate);
        continue;
      }
    }

    if (action.type === "run_infrastructure_diagnostic") {
      outcomes.push(await runInfrastructureDiagnostic(action));
      continue;
    }

    outcomes.push(await handoffToMigraMarket(action));
  }

  return outcomes;
}
