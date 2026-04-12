import type { RunOverlay, ToolExecutionResult } from "../shared/types";

interface ExecuteApiInput {
  runnerTarget: "local" | "server";
  toolName: string;
  toolInput: Record<string, unknown>;
  environment: "dev" | "stage" | "staging" | "prod" | "test";
  operator: {
    operatorId: string;
    role: string;
    claims?: Record<string, unknown>;
  };
  runId: string;
  autonomyBudgetId?: string;
  humanKeyTurnCode?: string;
}

export interface ExecuteApiResult {
  overlay?: RunOverlay;
  result?: ToolExecutionResult;
  doneStatus?: string;
  approvalRequired?: {
    approvalId: string;
    message?: string;
    risk?: string;
    toolName?: string;
  };
}

function parseEventBlock(block: string): { event?: string; data?: unknown } {
  const lines = block.split("\n");
  const eventLine = lines.find((line) => line.startsWith("event:"));
  const dataLine = lines.find((line) => line.startsWith("data:"));
  if (!eventLine || !dataLine) {
    return {};
  }
  const event = eventLine.slice(6).trim();
  const dataRaw = dataLine.slice(5).trim();
  try {
    return { event, data: JSON.parse(dataRaw) as unknown };
  } catch {
    return { event };
  }
}

async function invokeExecuteRoute(payload: ExecuteApiInput): Promise<Response> {
  if (process.env.MIGRAPILOT_BRAIN_BASE_URL) {
    return fetch(`${process.env.MIGRAPILOT_BRAIN_BASE_URL.replace(/\/$/, "")}/api/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
  }

  const { POST: executeRoutePost } = await import("../../app/api/execute/route");
  const request = new Request("http://localhost/api/execute", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  return executeRoutePost(request);
}

export async function executeViaBrainApi(payload: ExecuteApiInput): Promise<ExecuteApiResult> {
  const response = await invokeExecuteRoute(payload);
  if (!response.body) {
    return {
      result: {
        ok: false,
        data: {},
        warnings: [],
        error: {
          code: "INTERNAL_ERROR",
          message: "execute route returned empty body",
          retryable: false
        }
      }
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  let overlay: RunOverlay | undefined;
  let result: ToolExecutionResult | undefined;
  let doneStatus: string | undefined;
  let approvalRequired: ExecuteApiResult["approvalRequired"];

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";

    for (const block of blocks) {
      const parsed = parseEventBlock(block);
      if (!parsed.event) {
        continue;
      }

      if (parsed.event === "policy" && parsed.data && typeof parsed.data === "object") {
        overlay = parsed.data as RunOverlay;
        continue;
      }
      if (parsed.event === "result" && parsed.data && typeof parsed.data === "object") {
        const data = parsed.data as {
          overlay?: RunOverlay;
          result?: ToolExecutionResult;
        };
        if (data.overlay) {
          overlay = data.overlay;
        }
        if (data.result) {
          result = data.result;
        }
        continue;
      }
      if (parsed.event === "approval_required" && parsed.data && typeof parsed.data === "object") {
        const data = parsed.data as {
          approvalId?: string;
          message?: string;
          risk?: string;
          toolName?: string;
        };
        if (data.approvalId) {
          approvalRequired = {
            approvalId: data.approvalId,
            message: data.message,
            risk: data.risk,
            toolName: data.toolName
          };
        }
        continue;
      }
      if (parsed.event === "done" && parsed.data && typeof parsed.data === "object") {
        doneStatus = (parsed.data as { status?: string }).status;
      }
    }
  }

  return {
    overlay,
    result,
    doneStatus,
    approvalRequired
  };
}
