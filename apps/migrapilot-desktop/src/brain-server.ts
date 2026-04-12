import { randomUUID } from "node:crypto";

import express from "express";

import { sanitize } from "./sanitize.js";
import type { ServiceName, ServiceManager } from "./service-manager.js";
import type { DesktopSettings, EnvironmentName, RunnerTarget } from "./settings.js";

interface ToolingModule {
  getToolOrThrow: (name: string) => {
    name: string;
    tier: number;
    executionScope?: "local" | "server" | "both";
    envRiskModifier?: Partial<Record<EnvironmentName, number>>;
    abac?: {
      require?: Array<{
        attr: string;
        op: "exists" | "in" | "eq" | "contains";
        value?: unknown;
      }>;
    };
  };
  getEffectiveTier: (
    tool: {
      tier: number;
      envRiskModifier?: Partial<Record<EnvironmentName, number>>;
    },
    env: EnvironmentName,
    envRiskModifier?: Partial<Record<EnvironmentName, number>>
  ) => number;
  getToolExecutionScope: (tool: {
    executionScope?: "local" | "server" | "both";
  }) => "local" | "server" | "both";
  signJob: (
    payload: {
      toolName: string;
      environment: EnvironmentName;
      runnerType: "local" | "server";
      effectiveTier: number;
      operatorId: string;
      autonomyBudgetId: string | null;
      issuedAt: string;
      expiresAt: string;
      nonce: string;
      jobId: string;
    },
    key: string
  ) => string;
}

interface BrainServerOptions {
  port: number;
  consoleBaseUrl: string;
  serviceManager: ServiceManager;
  getSettings: () => DesktopSettings;
  saveSettings: (next: Partial<DesktopSettings>) => DesktopSettings;
}

interface BrainServerController {
  url: string;
  isRunning: () => boolean;
  isManagedByDesktop: () => boolean;
  restart: () => Promise<void>;
  close: () => Promise<void>;
}

interface ExecuteRequest {
  toolName?: string;
  toolInput?: Record<string, unknown>;
  input?: Record<string, unknown>;
  runnerTarget?: RunnerTarget;
  environment?: EnvironmentName;
  operator?: {
    operatorId?: string;
    role?: string;
    claims?: Record<string, unknown>;
  };
  runId?: string;
  autonomyBudgetId?: string;
  humanKeyTurnCode?: string;
}

interface PendingApproval {
  approvalId: string;
  createdAt: string;
  status: "pending" | "approved" | "rejected";
  toolName: string;
  runId: string;
  summary: string;
  risk: string;
  request: ExecuteRequest;
  humanKeyTurnCode?: string;
}

let toolingPromise: Promise<ToolingModule> | null = null;

async function loadToolingModule(): Promise<ToolingModule> {
  if (!toolingPromise) {
    const override = process.env.MIGRAPILOT_TOOLING_MODULE;
    const modulePath = override && override.trim() ? override : "../../../packages/tooling/dist/index.js";
    toolingPromise = import(modulePath) as unknown as Promise<ToolingModule>;
  }
  return toolingPromise;
}

function normalizeEnvironment(value: unknown, fallback: EnvironmentName): EnvironmentName {
  return value === "dev" || value === "stage" || value === "staging" || value === "prod" || value === "test"
    ? value
    : fallback;
}

function normalizeRunnerTarget(value: unknown, fallback: RunnerTarget): RunnerTarget {
  return value === "local" || value === "server" || value === "auto" ? value : fallback;
}

function getNestedAttr(target: Record<string, unknown>, dottedPath: string): unknown {
  const segments = dottedPath.split(".");
  let cursor: unknown = target;
  for (const segment of segments) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

function evaluateAbac(
  tool: {
    abac?: {
      require?: Array<{
        attr: string;
        op: "exists" | "in" | "eq" | "contains";
        value?: unknown;
      }>;
    };
  },
  context: Record<string, unknown>
): { decision: "allow" | "deny"; reason: string } {
  const rules = tool.abac?.require ?? [];
  for (const rule of rules) {
    const value = getNestedAttr(context, rule.attr);
    if (rule.op === "exists") {
      if (value === null || value === undefined || value === "") {
        return { decision: "deny", reason: `${rule.attr} missing` };
      }
      continue;
    }
    if (rule.op === "eq") {
      if (value !== rule.value) {
        return { decision: "deny", reason: `${rule.attr} mismatch` };
      }
      continue;
    }
    if (rule.op === "in") {
      if (!Array.isArray(rule.value) || !rule.value.includes(value)) {
        return { decision: "deny", reason: `${rule.attr} not allowed` };
      }
      continue;
    }
    if (rule.op === "contains") {
      if (!Array.isArray(value) || !value.includes(rule.value)) {
        return { decision: "deny", reason: `${rule.attr} missing required value` };
      }
    }
  }
  return { decision: "allow", reason: "ABAC allow" };
}

function parseSigningKeys(): Record<string, string> {
  const keys: Record<string, string> = {};
  if (process.env.MIGRAPILOT_JOB_SIGNING_KEYS) {
    try {
      const parsed = JSON.parse(process.env.MIGRAPILOT_JOB_SIGNING_KEYS) as Record<string, unknown>;
      for (const [keyId, value] of Object.entries(parsed)) {
        if (typeof value === "string" && value.trim()) {
          keys[keyId] = value;
        }
      }
    } catch {
      // ignored
    }
  }
  if (process.env.MIGRAPILOT_JOB_SIGNING_KEY && !keys.default) {
    keys.default = process.env.MIGRAPILOT_JOB_SIGNING_KEY;
  }
  return keys;
}

function resolveSigner(): { keyId: string; key: string } | null {
  const keys = parseSigningKeys();
  const keyId = Object.keys(keys)[0];
  if (!keyId) {
    return null;
  }
  return { keyId, key: keys[keyId] };
}

function requiresSignedJob(runnerType: "local" | "server", effectiveTier: number): boolean {
  if (runnerType === "server") {
    return effectiveTier >= 1;
  }
  return effectiveTier >= 2;
}

function resolveRunnerByHeuristics(toolName: string): "local" | "server" {
  if (/^(repo\.|git\.)/.test(toolName)) {
    return "local";
  }
  if (/^(inventory\.|dns\.|pods\.|storage\.|deploy\.|system\.)/.test(toolName)) {
    return "server";
  }
  if (/^journal\./.test(toolName)) {
    return "server";
  }
  return "local";
}

function resolveRunnerTarget(input: {
  requestedRunner: RunnerTarget;
  scope: "local" | "server" | "both";
  environment: EnvironmentName;
  effectiveTier: number;
  toolName: string;
}): { ok: true; runner: "local" | "server"; reason: string } | { ok: false; message: string } {
  const envRequiresServer = input.environment === "prod";
  const tierRequiresServer = input.effectiveTier >= 2;

  if (input.requestedRunner === "local" || input.requestedRunner === "server") {
    const forced = input.requestedRunner;
    if (input.scope === "local" && forced !== "local") {
      return { ok: false, message: "Tool executionScope is local and cannot run on server" };
    }
    if (input.scope === "server" && forced !== "server") {
      return { ok: false, message: "Tool executionScope is server and cannot run on local" };
    }
    if (forced === "local" && envRequiresServer) {
      return { ok: false, message: "prod environment requires server runner" };
    }
    if (forced === "local" && tierRequiresServer) {
      return { ok: false, message: "effectiveTier >= 2 requires server runner" };
    }
    return { ok: true, runner: forced, reason: "forced runner target" };
  }

  if (input.scope === "local") {
    if (envRequiresServer || tierRequiresServer) {
      return { ok: false, message: "Tool is local-scoped but policy requires server execution" };
    }
    return { ok: true, runner: "local", reason: "executionScope=local" };
  }

  if (input.scope === "server") {
    return { ok: true, runner: "server", reason: "executionScope=server" };
  }

  if (envRequiresServer) {
    return { ok: true, runner: "server", reason: "environment=prod" };
  }
  if (tierRequiresServer) {
    return { ok: true, runner: "server", reason: "effectiveTier>=2" };
  }

  return {
    ok: true,
    runner: resolveRunnerByHeuristics(input.toolName),
    reason: "auto heuristic"
  };
}

function buildRunnerUrl(settings: DesktopSettings, runner: "local" | "server"): string {
  if (runner === "local") {
    return process.env.MIGRAPILOT_LOCAL_RUNNER_URL ?? "http://127.0.0.1:7788";
  }
  return settings.serverRunnerUrl || process.env.MIGRAPILOT_SERVER_RUNNER_URL || "http://127.0.0.1:7789";
}

async function proxyToConsole(request: express.Request, response: express.Response, consoleBaseUrl: string): Promise<void> {
  const url = `${consoleBaseUrl.replace(/\/$/, "")}${request.originalUrl}`;
  const method = request.method.toUpperCase();

  const upstream = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json"
    },
    body: method === "GET" || method === "HEAD" ? undefined : JSON.stringify(request.body ?? {})
  });

  const contentType = upstream.headers.get("content-type") ?? "text/plain";
  response.status(upstream.status);
  response.setHeader("content-type", contentType);

  if (contentType.includes("application/json")) {
    const payload = await upstream.json();
    response.json(sanitize(payload));
    return;
  }

  response.send(await upstream.text());
}

export async function createBrainServer(options: BrainServerOptions): Promise<BrainServerController> {
  const app = express();
  app.use(express.json({ limit: "4mb" }));
  app.use((request, response, next) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    if (request.method === "OPTIONS") {
      response.status(204).end();
      return;
    }
    next();
  });

  const approvals = new Map<string, PendingApproval>();

  let server: ReturnType<typeof app.listen> | null = null;
  let running = false;
  let managedByDesktop = false;

  const isExistingBrainHealthy = async (): Promise<boolean> => {
    try {
      const response = await fetch(`http://127.0.0.1:${options.port}/health`, { method: "GET" });
      if (!response.ok) {
        return false;
      }
      const payload = (await response.json()) as { ok?: boolean };
      return Boolean(payload?.ok);
    } catch {
      return false;
    }
  };

  const executeWithPolicy = async (payload: ExecuteRequest) => {
    const settings = options.getSettings();
    if (!payload.toolName) {
      return {
        ok: false,
        status: 400,
        error: { code: "VALIDATION_ERROR", message: "toolName is required", retryable: false }
      };
    }

    const toolInput = payload.toolInput ?? payload.input ?? {};
    const environment = normalizeEnvironment(payload.environment ?? (toolInput.environment as string), settings.defaultEnvironment);

    const operator = {
      operatorId: (payload.operator?.operatorId ?? settings.operatorId).trim() || settings.operatorId,
      role: (payload.operator?.role ?? settings.role).trim() || settings.role,
      claims: payload.operator?.claims
    };

    const requestedRunner = normalizeRunnerTarget(payload.runnerTarget, settings.defaultRunnerTarget);

    const tooling = await loadToolingModule();
    let tool;
    try {
      tool = tooling.getToolOrThrow(payload.toolName);
    } catch {
      return {
        ok: false,
        status: 404,
        error: { code: "NOT_FOUND", message: `Unknown tool: ${payload.toolName}`, retryable: false }
      };
    }

    const baseTier = tool.tier;
    const effectiveTier = tooling.getEffectiveTier(tool, environment, undefined);
    const scope = tooling.getToolExecutionScope(tool);

    const runnerResolution = resolveRunnerTarget({
      requestedRunner,
      scope,
      environment,
      effectiveTier,
      toolName: payload.toolName
    });

    if (!runnerResolution.ok) {
      return {
        ok: false,
        status: 400,
        error: {
          code: "POLICY_VIOLATION",
          message: runnerResolution.message,
          retryable: false
        },
        overlay: {
          toolName: payload.toolName,
          runnerUsed: null,
          reason: runnerResolution.message,
          baseTier,
          effectiveTier,
          executionScope: scope
        }
      };
    }

    const abac = evaluateAbac(tool, {
      environment,
      operator,
      runner: {
        runnerId: "desktop-brain",
        runnerType: runnerResolution.runner
      }
    });

    if (abac.decision === "deny") {
      return {
        ok: false,
        status: 403,
        error: {
          code: "POLICY_VIOLATION",
          message: `ABAC deny: ${abac.reason}`,
          retryable: false
        },
        overlay: {
          toolName: payload.toolName,
          runnerUsed: runnerResolution.runner,
          reason: abac.reason,
          baseTier,
          effectiveTier,
          executionScope: scope
        }
      };
    }

    if (process.env.MIGRAPILOT_POLICY_MODE === "read-only" && effectiveTier >= 1) {
      return {
        ok: false,
        status: 403,
        error: {
          code: "POLICY_VIOLATION",
          message: "Policy mode is read-only; mutating tools are blocked",
          retryable: false
        },
        overlay: {
          toolName: payload.toolName,
          runnerUsed: runnerResolution.runner,
          reason: "read-only policy",
          baseTier,
          effectiveTier,
          executionScope: scope
        }
      };
    }

    const runId = payload.runId ?? `run_${randomUUID()}`;

    if (effectiveTier >= 3 && !payload.humanKeyTurnCode) {
      const approvalId = `approval_${randomUUID()}`;
      approvals.set(approvalId, {
        approvalId,
        createdAt: new Date().toISOString(),
        status: "pending",
        toolName: payload.toolName,
        runId,
        summary: `Tier 3 approval required for ${payload.toolName}`,
        risk: "High blast radius operation requires human key turn",
        request: {
          ...payload,
          runId,
          toolInput
        }
      });
      return {
        ok: false,
        status: 409,
        error: {
          code: "TIER3_KEY_TURN_REQUIRED",
          message: "Tier 3 operation requires humanKeyTurnCode",
          retryable: false
        },
        approvalRequired: {
          approvalId,
          runId,
          toolName: payload.toolName,
          risk: "High blast radius operation requires human key turn"
        },
        overlay: {
          toolName: payload.toolName,
          runnerUsed: runnerResolution.runner,
          reason: "tier3 approval required",
          baseTier,
          effectiveTier,
          executionScope: scope
        }
      };
    }

    let jobEnvelope: {
      jobId: string;
      issuedAt: string;
      expiresAt: string;
      nonce: string;
      signerKeyId?: string;
      signature: string;
    } | null = null;

    const signRequired = requiresSignedJob(runnerResolution.runner, effectiveTier);
    if (signRequired) {
      const signer = resolveSigner();
      if (!signer) {
        return {
          ok: false,
          status: 403,
          error: {
            code: "POLICY_VIOLATION",
            message: "MIGRAPILOT_JOB_SIGNING_KEY is required for this execution",
            retryable: false
          },
          overlay: {
            toolName: payload.toolName,
            runnerUsed: runnerResolution.runner,
            reason: "missing signing key",
            baseTier,
            effectiveTier,
            executionScope: scope
          }
        };
      }

      const issuedAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 120000).toISOString();
      const nonce = `nonce_${randomUUID()}`;
      const jobId = `job_${randomUUID()}`;
      const signature = tooling.signJob(
        {
          toolName: payload.toolName,
          environment,
          runnerType: runnerResolution.runner,
          effectiveTier,
          operatorId: operator.operatorId,
          autonomyBudgetId: payload.autonomyBudgetId ?? "desktop-default",
          issuedAt,
          expiresAt,
          nonce,
          jobId
        },
        signer.key
      );

      jobEnvelope = {
        jobId,
        issuedAt,
        expiresAt,
        nonce,
        signerKeyId: signer.keyId,
        signature
      };
    }

    const runnerUrl = buildRunnerUrl(settings, runnerResolution.runner);
    const payloadToRunner = {
      toolName: payload.toolName,
      input: {
        ...toolInput,
        runId,
        environment,
        operator,
        runner: {
          runnerId: `desktop-brain-${runnerResolution.runner}`,
          runnerType: runnerResolution.runner
        },
        autonomyBudget: {
          id: payload.autonomyBudgetId ?? "desktop-default"
        },
        ...(payload.humanKeyTurnCode ? { humanKeyTurnCode: payload.humanKeyTurnCode } : {}),
        ...(jobEnvelope ? { job: jobEnvelope } : {})
      }
    };

    const runnerResponse = await fetch(`${runnerUrl.replace(/\/$/, "")}/execute`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(payloadToRunner)
    });

    const resultPayload = runnerResponse.ok
      ? await runnerResponse.json()
      : {
          ok: false,
          data: {},
          warnings: [],
          error: {
            code: "PROVIDER_UNAVAILABLE",
            message: `Runner call failed: HTTP ${runnerResponse.status}`,
            retryable: true
          }
        };

    return {
      ok: true,
      status: runnerResponse.ok ? 200 : 502,
      data: {
        runId,
        overlay: {
          toolName: payload.toolName,
          runnerUsed: runnerResolution.runner,
          reason: runnerResolution.reason,
          baseTier,
          effectiveTier,
          executionScope: scope,
          jobId: jobEnvelope?.jobId
        },
        result: sanitize(resultPayload)
      }
    };
  };

  app.get("/health", (_request, response) => {
    response.json({ ok: true, service: "brain", port: options.port });
  });

  app.get("/api/settings", (_request, response) => {
    response.json({ ok: true, data: sanitize(options.getSettings()) });
  });

  app.post("/api/settings", (request, response) => {
    const next = request.body as Partial<DesktopSettings>;
    const updated = options.saveSettings(next);
    response.json({ ok: true, data: sanitize(updated) });
  });

  app.get("/api/services/status", (_request, response) => {
    response.json({
      ok: true,
      data: {
        brain: {
          running,
          port: options.port,
          managedByDesktop
        },
        services: options.serviceManager.getStatus()
      }
    });
  });

  app.get("/api/services/logs/:service", (request, response) => {
    const service = request.params.service as ServiceName;
    if (service !== "console" && service !== "runner-local") {
      response.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Unknown service" } });
      return;
    }
    response.json({ ok: true, data: { service, logs: options.serviceManager.getLogs(service) } });
  });

  app.post("/api/services/:service/:action", async (request, response) => {
    const service = request.params.service;
    const action = request.params.action;

    if (service === "brain") {
      if (action !== "restart") {
        response.status(400).json({ ok: false, error: { code: "VALIDATION_ERROR", message: "brain only supports restart" } });
        return;
      }
      response.json({ ok: true, data: { service: "brain", action: "restart", accepted: true } });
      setTimeout(() => {
        void controller.restart();
      }, 50);
      return;
    }

    if (service !== "console" && service !== "runner-local") {
      response.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Unknown service" } });
      return;
    }

    try {
      if (action === "start") {
        await options.serviceManager.start(service);
      } else if (action === "stop") {
        await options.serviceManager.stop(service);
      } else if (action === "restart") {
        await options.serviceManager.restart(service);
      } else {
        response.status(400).json({ ok: false, error: { code: "VALIDATION_ERROR", message: "Unknown action" } });
        return;
      }
      response.json({ ok: true, data: { services: options.serviceManager.getStatus() } });
    } catch (error) {
      response.status(500).json({
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: (error as Error).message
        }
      });
    }
  });

  app.get("/api/approvals", (_request, response) => {
    response.json({ ok: true, data: { approvals: sanitize(Array.from(approvals.values())) } });
  });

  app.post("/api/approvals/:approvalId", async (request, response) => {
    const approvalId = request.params.approvalId;
    const action = request.body?.action as "approve" | "reject" | undefined;
    const approval = approvals.get(approvalId);
    if (!approval) {
      response.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Approval not found" } });
      return;
    }

    if (action === "reject") {
      approval.status = "rejected";
      approvals.set(approvalId, approval);
      response.json({ ok: true, data: { approval: sanitize(approval) } });
      return;
    }

    const code = request.body?.humanKeyTurnCode as string | undefined;
    if (!code || !code.trim()) {
      response.status(400).json({ ok: false, error: { code: "VALIDATION_ERROR", message: "humanKeyTurnCode is required" } });
      return;
    }

    approval.status = "approved";
    approval.humanKeyTurnCode = code.trim();
    approvals.set(approvalId, approval);

    const rerun = await executeWithPolicy({
      ...approval.request,
      humanKeyTurnCode: code.trim()
    });

    response.status(rerun.status).json(
      sanitize({
        ok: rerun.ok,
        data: {
          approval: sanitize(approval),
          ...(rerun.ok ? rerun.data : {}),
          ...(rerun.approvalRequired ? { approvalRequired: rerun.approvalRequired } : {})
        },
        error: rerun.ok ? null : rerun.error
      })
    );
  });

  app.post("/api/execute", async (request, response) => {
    try {
      const executed = await executeWithPolicy(request.body as ExecuteRequest);
      response.status(executed.status).json(
        sanitize({
          ok: executed.ok,
          ...(executed.ok ? { data: executed.data } : { error: executed.error }),
          ...(executed.approvalRequired ? { approvalRequired: executed.approvalRequired } : {}),
          ...(executed.overlay ? { overlay: executed.overlay } : {})
        })
      );
    } catch (error) {
      response.status(500).json({
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: (error as Error).message,
          retryable: false
        }
      });
    }
  });

  // Proxy mission/chat/inventory/journal/repo endpoints to existing Next.js console API.
  app.all("/api/chat", async (request, response) => {
    await proxyToConsole(request, response, options.consoleBaseUrl);
  });
  app.all("/api/state", async (request, response) => {
    await proxyToConsole(request, response, options.consoleBaseUrl);
  });
  app.all("/api/mission/*", async (request, response) => {
    await proxyToConsole(request, response, options.consoleBaseUrl);
  });
  app.all("/api/journal/list", async (request, response) => {
    await proxyToConsole(request, response, options.consoleBaseUrl);
  });
  app.all("/api/inventory/*", async (request, response) => {
    await proxyToConsole(request, response, options.consoleBaseUrl);
  });
  app.all("/api/repo/*", async (request, response) => {
    await proxyToConsole(request, response, options.consoleBaseUrl);
  });
  // Inline completion — proxy to console which relays to pilot-api LLM
  app.all("/api/complete", async (request, response) => {
    await proxyToConsole(request, response, options.consoleBaseUrl);
  });

  const start = async (): Promise<void> => {
    if (server) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const candidate = app.listen(options.port);
      const onListening = () => {
        candidate.off("error", onError);
        server = candidate;
        running = true;
        managedByDesktop = true;
        resolve();
      };
      const onError = async (error: NodeJS.ErrnoException) => {
        candidate.off("listening", onListening);
        candidate.close();
        if (error?.code === "EADDRINUSE" && (await isExistingBrainHealthy())) {
          // Another healthy brain instance already owns this port; reuse it.
          server = null;
          running = true;
          managedByDesktop = false;
          resolve();
          return;
        }
        reject(error);
      };
      candidate.on("listening", onListening);
      candidate.on("error", onError);
    });
  };

  const stop = async (): Promise<void> => {
    if (!server) {
      if (managedByDesktop) {
        running = false;
      } else {
        running = await isExistingBrainHealthy();
      }
      return;
    }
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    server = null;
    running = false;
    managedByDesktop = false;
  };

  const controller: BrainServerController = {
    url: `http://127.0.0.1:${options.port}`,
    isRunning: () => running,
    isManagedByDesktop: () => managedByDesktop,
    restart: async () => {
      if (!managedByDesktop) {
        running = await isExistingBrainHealthy();
        return;
      }
      await stop();
      await start();
    },
    close: async () => {
      await stop();
    }
  };

  await start();
  return controller;
}
