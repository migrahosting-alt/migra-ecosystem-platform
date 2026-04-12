import express from "express";

import { executeTool } from "../../../packages/tooling/dist/index.js";

const app = express();
const port = Number(process.env.PORT ?? 7788);

app.use(express.json({ limit: "2mb" }));

app.get("/health", (_request, response) => {
  response.json({ ok: true, runner: "local", port });
});

app.post("/execute", async (request, response) => {
  const body = request.body as {
    toolName?: unknown;
    input?: unknown;
  };

  if (typeof body?.toolName !== "string") {
    response.status(400).json({ ok: false, error: { code: "VALIDATION_ERROR", message: "toolName is required" } });
    return;
  }
  if (!body.input || typeof body.input !== "object" || Array.isArray(body.input)) {
    response.status(400).json({ ok: false, error: { code: "VALIDATION_ERROR", message: "input object is required" } });
    return;
  }

  const input = body.input as Record<string, unknown>;
  const context = {
    environment: (input.environment as "dev" | "stage" | "staging" | "prod" | "test" | undefined) ?? "dev",
    operator: (input.operator as Record<string, unknown> | undefined) ?? {},
    runner: {
      runnerId: "local-runner-1",
      runnerType: "local" as const
    },
    runId: (input.runId as string | undefined) ?? undefined,
    autonomyBudget:
      input.autonomyBudget && typeof input.autonomyBudget === "object" && !Array.isArray(input.autonomyBudget)
        ? (input.autonomyBudget as { id?: string | null })
        : null,
    job:
      input.job && typeof input.job === "object" && !Array.isArray(input.job)
        ? (input.job as {
            jobId: string;
            issuedAt: string;
            expiresAt: string;
            nonce: string;
            signerKeyId?: string;
            signature: string;
          })
        : null
  };

  console.log(`[runner-local] tool=${body.toolName} runId=${context.runId ?? "none"}`);

  try {
    const result = await executeTool({
      toolName: body.toolName,
      input,
      context
    });
    response.json(result);
  } catch (error) {
    response.status(500).json({
      ok: false,
      data: {},
      warnings: [],
      error: {
        code: "INTERNAL_ERROR",
        message: (error as Error).message,
        retryable: false
      }
    });
  }
});

app.listen(port, () => {
  console.log(`[runner-local] listening on :${port}`);
});
