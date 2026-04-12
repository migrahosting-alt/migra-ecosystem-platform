import { randomUUID } from "node:crypto";

import { createApproval, recordRun } from "../../../lib/server/store";
import { sanitize } from "../../../lib/server/sanitize";
import { executeToolWithPolicy, getExecutionMetadata } from "../../../lib/server/tool-runtime";
import type { ToolExecutionRequest } from "../../../lib/shared/types";

interface ExecuteRequest {
  runnerTarget?: "local" | "server";
  runnerType?: "local" | "server";
  toolName?: string;
  toolInput?: Record<string, unknown>;
  input?: Record<string, unknown>;
  environment?: "dev" | "stage" | "staging" | "prod" | "test";
  operator?: {
    operatorId?: string;
    role?: string;
    claims?: Record<string, unknown>;
  };
  runId?: string;
  autonomyBudgetId?: string;
  humanKeyTurnCode?: string;
}

function sse(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as ExecuteRequest;
  const toolName = body.toolName;
  if (!toolName) {
    return new Response(
      JSON.stringify({ ok: false, error: { code: "VALIDATION_ERROR", message: "toolName required" } }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  const toolInput = body.toolInput ?? body.input ?? {};
  const environment =
    body.environment ??
    ((toolInput.environment as ToolExecutionRequest["environment"] | undefined) ?? "dev");
  const runnerType = body.runnerTarget ?? body.runnerType ?? "local";
  const runId = body.runId ?? `run_${randomUUID()}`;

  const operator = {
    operatorId:
      body.operator?.operatorId ??
      (typeof toolInput.operator === "object" && toolInput.operator
        ? String((toolInput.operator as Record<string, unknown>).operatorId ?? "console-operator")
        : "console-operator"),
    role:
      body.operator?.role ??
      (typeof toolInput.operator === "object" && toolInput.operator
        ? String((toolInput.operator as Record<string, unknown>).role ?? "owner")
        : "owner"),
    claims: body.operator?.claims
  };

  const execution: ToolExecutionRequest = {
    toolName,
    input: toolInput,
    environment,
    runnerType,
    operator,
    runId,
    autonomyBudgetId: body.autonomyBudgetId ?? "default",
    humanKeyTurnCode: body.humanKeyTurnCode
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(sse("start", { runId, toolName: execution.toolName }));

      const meta = await getExecutionMetadata({
        toolName: execution.toolName,
        environment: execution.environment,
        runnerType: execution.runnerType,
        operator: execution.operator
      });

      if (!meta.ok) {
        const denied = {
          ok: false,
          data: {},
          warnings: [],
          error: meta.error
        };
        controller.enqueue(sse("result", { runId, result: denied }));
        controller.enqueue(sse("done", { runId, status: "denied" }));
        controller.close();
        return;
      }

      if (meta.meta.effectiveTier >= 3 && !execution.humanKeyTurnCode) {
        const approval = createApproval({
          toolName: execution.toolName,
          runId,
          summary: `Tier 3 action pending approval for ${execution.toolName}`,
          risk: "High blast radius operation requires human key turn",
          request: execution
        });

        recordRun({
          id: runId,
          createdAt: new Date().toISOString(),
          status: "denied",
          overlay: {
            toolName: meta.meta.toolName,
            env: execution.environment,
            runnerType: execution.runnerType,
            baseTier: meta.meta.baseTier,
            effectiveTier: meta.meta.effectiveTier,
            executionScope: meta.meta.executionScope,
            abacDecision: "allow",
            abacReason: "Tier 3 pending approval",
            budgetsConsumed: meta.meta.budgetsConsumed
          },
          input: sanitize(execution.input) as Record<string, unknown>,
          output: {
            ok: false,
            data: {},
            warnings: [],
            error: {
              code: "TIER3_KEY_TURN_REQUIRED",
              message: "Tier 3 operation requires humanKeyTurnCode",
              retryable: false
            }
          },
          error: "Tier 3 approval required"
        });

        controller.enqueue(
          sse("approval_required", {
            approvalId: approval.id,
            runId,
            message: "Tier 3 operation requires approval",
            risk: approval.risk,
            toolName: execution.toolName
          })
        );
        controller.enqueue(sse("done", { runId, status: "pending_approval" }));
        controller.close();
        return;
      }

      const final = await executeToolWithPolicy(execution);
      controller.enqueue(sse("policy", final.overlay));

      const status = final.result.ok
        ? "completed"
        : final.result.error?.code === "POLICY_VIOLATION"
          ? "denied"
          : "failed";

      recordRun({
        id: runId,
        createdAt: new Date().toISOString(),
        status,
        overlay: final.overlay,
        input: sanitize(execution.input) as Record<string, unknown>,
        output: sanitize(final.result) as typeof final.result,
        error: final.result.error?.message
      });

      controller.enqueue(
        sse("result", {
          runId,
          overlay: final.overlay,
          result: sanitize(final.result)
        })
      );
      controller.enqueue(sse("done", { runId, status }));
      controller.close();
    }
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive"
    }
  });
}
