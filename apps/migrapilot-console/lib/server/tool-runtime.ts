import { randomUUID } from "node:crypto";

import type {
  ExecutionEnvironment,
  RunOverlay,
  ToolExecutionRequest,
  ToolExecutionResult
} from "../shared/types";

interface ToolingModule {
  getToolOrThrow: (name: string) => {
    name: string;
    tier: number;
    executionScope?: "local" | "server" | "both";
    abac?: {
      require?: Array<{
        attr: string;
        op: "exists" | "in" | "eq" | "contains";
        value?: unknown;
      }>;
    };
    budgets?: {
      maxMutationsPerRun?: number;
    };
  };
  getEffectiveTier: (
    tool: {
      tier: number;
      envRiskModifier?: Partial<Record<ExecutionEnvironment, number>>;
    },
    env: ExecutionEnvironment,
    envRiskModifier?: Partial<Record<ExecutionEnvironment, number>>
  ) => number;
  getToolExecutionScope: (tool: {
    executionScope?: "local" | "server" | "both";
  }) => "local" | "server" | "both";
  signJob: (
    payload: {
      toolName: string;
      environment: ExecutionEnvironment;
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

interface SignedJobEnvelope {
  jobId: string;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
  signerKeyId?: string;
  signature: string;
}

interface ExecutePayload {
  toolName: string;
  input: Record<string, unknown>;
}

interface ToolMetadata {
  toolName: string;
  baseTier: number;
  effectiveTier: number;
  executionScope: "local" | "server" | "both";
  abacDecision: "allow" | "deny";
  abacReason: string;
  budgetsConsumed: {
    writes?: number;
    commands?: number;
  };
}

let toolingPromise: Promise<ToolingModule> | null = null;

async function loadTooling(): Promise<ToolingModule> {
  if (!toolingPromise) {
    toolingPromise = import("../../../../packages/tooling/dist/index.js") as unknown as Promise<ToolingModule>;
  }
  return toolingPromise;
}

function getRunnerUrl(runnerType: "local" | "server"): string {
  if (runnerType === "server") {
    return process.env.MIGRAPILOT_SERVER_RUNNER_URL ?? "https://migrapilot-runner.internal:7789";
  }
  return process.env.MIGRAPILOT_LOCAL_RUNNER_URL ?? "http://localhost:7788";
}

function getNestedAttr(target: Record<string, unknown>, dottedPath: string): unknown {
  const segments = dottedPath.split(".");
  let current: unknown = target;
  for (const segment of segments) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
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

function getSigner(): { keyId: string; key: string } | null {
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

async function issueSignedJob(input: {
  toolName: string;
  environment: ExecutionEnvironment;
  runnerType: "local" | "server";
  effectiveTier: number;
  operatorId: string;
  autonomyBudgetId?: string | null;
}): Promise<SignedJobEnvelope | null> {
  const signer = getSigner();
  if (!signer) {
    return null;
  }

  const tooling = await loadTooling();
  const now = Date.now();
  const issuedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + 120000).toISOString();
  const nonce = `nonce_${randomUUID()}`;
  const jobId = `job_${randomUUID()}`;
  const signature = tooling.signJob(
    {
      toolName: input.toolName,
      environment: input.environment,
      runnerType: input.runnerType,
      effectiveTier: input.effectiveTier,
      operatorId: input.operatorId,
      autonomyBudgetId: input.autonomyBudgetId ?? null,
      issuedAt,
      expiresAt,
      nonce,
      jobId
    },
    signer.key
  );

  return {
    jobId,
    issuedAt,
    expiresAt,
    nonce,
    signerKeyId: signer.keyId,
    signature
  };
}

async function executeViaRunner(
  runnerType: "local" | "server",
  payload: ExecutePayload
): Promise<ToolExecutionResult> {
  const endpoint = `${getRunnerUrl(runnerType).replace(/\/$/, "")}/execute`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    return {
      ok: false,
      data: {},
      warnings: [],
      error: {
        code: "RUNNER_UNAVAILABLE",
        message: `Runner call failed: HTTP ${response.status}`,
        retryable: true
      }
    };
  }

  return (await response.json()) as ToolExecutionResult;
}

export async function getExecutionMetadata(input: {
  toolName: string;
  environment: ExecutionEnvironment;
  runnerType: "local" | "server";
  operator: {
    operatorId: string;
    role: string;
    claims?: Record<string, unknown>;
  };
}): Promise<{ ok: true; meta: ToolMetadata } | { ok: false; error: ToolExecutionResult["error"] }> {
  const tooling = await loadTooling();
  let tool;
  try {
    tool = tooling.getToolOrThrow(input.toolName);
  } catch {
    return {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: `Unknown tool: ${input.toolName}`,
        retryable: false
      }
    };
  }

  const effectiveTier = tooling.getEffectiveTier(tool, input.environment, undefined);
  const executionScope = tooling.getToolExecutionScope(tool);
  if (
    (executionScope === "local" && input.runnerType !== "local") ||
    (executionScope === "server" && input.runnerType !== "server")
  ) {
    return {
      ok: false,
      error: {
        code: "POLICY_VIOLATION",
        message: "Tool not allowed on this runner",
        retryable: false
      }
    };
  }

  const abac = evaluateAbac(tool, {
    operator: input.operator,
    environment: input.environment,
    runner: {
      runnerType: input.runnerType,
      runnerId: `${input.runnerType}-console`
    }
  });

  return {
    ok: true,
    meta: {
      toolName: tool.name,
      baseTier: tool.tier,
      effectiveTier,
      executionScope,
      abacDecision: abac.decision,
      abacReason: abac.reason,
      budgetsConsumed: {
        writes: effectiveTier >= 1 ? 1 : 0,
        commands: 1
      }
    }
  };
}

export async function executeToolWithPolicy(input: ToolExecutionRequest): Promise<{
  overlay: RunOverlay;
  result: ToolExecutionResult;
  job?: SignedJobEnvelope;
}> {
  const metaResult = await getExecutionMetadata({
    toolName: input.toolName,
    environment: input.environment,
    runnerType: input.runnerType,
    operator: input.operator
  });

  if (!metaResult.ok) {
    const denied: ToolExecutionResult = {
      ok: false,
      data: {},
      warnings: [],
      error: metaResult.error
    };
    return {
      overlay: {
        toolName: input.toolName,
        env: input.environment,
        runnerType: input.runnerType,
        baseTier: 0,
        effectiveTier: 0,
        executionScope: "both",
        abacDecision: "deny",
        abacReason: metaResult.error?.message ?? "Denied",
        budgetsConsumed: { commands: 1 }
      },
      result: denied
    };
  }

  const meta = metaResult.meta;
  if (meta.abacDecision === "deny") {
    const denied: ToolExecutionResult = {
      ok: false,
      data: {},
      warnings: [],
      error: {
        code: "POLICY_VIOLATION",
        message: `ABAC deny: ${meta.abacReason}`,
        retryable: false
      }
    };
    return {
      overlay: {
        toolName: input.toolName,
        env: input.environment,
        runnerType: input.runnerType,
        baseTier: meta.baseTier,
        effectiveTier: meta.effectiveTier,
        executionScope: meta.executionScope,
        abacDecision: "deny",
        abacReason: meta.abacReason,
        budgetsConsumed: meta.budgetsConsumed
      },
      result: denied
    };
  }

  const mustSign = requiresSignedJob(input.runnerType, meta.effectiveTier);
  const job = mustSign
    ? await issueSignedJob({
        toolName: input.toolName,
        environment: input.environment,
        runnerType: input.runnerType,
        effectiveTier: meta.effectiveTier,
        operatorId: input.operator.operatorId,
        autonomyBudgetId: input.autonomyBudgetId ?? null
      })
    : null;

  if (mustSign && !job) {
    const denied: ToolExecutionResult = {
      ok: false,
      data: {},
      warnings: [],
      error: {
        code: "POLICY_VIOLATION",
        message: "MIGRAPILOT_JOB_SIGNING_KEY is required for this execution",
        retryable: false
      }
    };
    return {
      overlay: {
        toolName: input.toolName,
        env: input.environment,
        runnerType: input.runnerType,
        baseTier: meta.baseTier,
        effectiveTier: meta.effectiveTier,
        executionScope: meta.executionScope,
        abacDecision: "deny",
        abacReason: "Missing signing key",
        budgetsConsumed: meta.budgetsConsumed
      },
      result: denied
    };
  }

  const runId = input.runId ?? `run_${randomUUID()}`;
  const enrichedInput: Record<string, unknown> = {
    ...input.input,
    runId,
    environment: input.environment,
    operator: input.operator,
    runner: {
      runnerId: `${input.runnerType}-runner`,
      runnerType: input.runnerType
    },
    autonomyBudget: input.autonomyBudgetId ? { id: input.autonomyBudgetId } : null,
    ...(job ? { job } : {}),
    ...(input.humanKeyTurnCode ? { humanKeyTurnCode: input.humanKeyTurnCode } : {})
  };

  const result = await executeViaRunner(input.runnerType, {
    toolName: input.toolName,
    input: enrichedInput
  });

  return {
    overlay: {
      toolName: meta.toolName,
      env: input.environment,
      runnerType: input.runnerType,
      baseTier: meta.baseTier,
      effectiveTier: meta.effectiveTier,
      executionScope: meta.executionScope,
      abacDecision: meta.abacDecision,
      abacReason: meta.abacReason,
      budgetsConsumed: meta.budgetsConsumed,
      journalEntryId: result.journalEntryId,
      jobId: job?.jobId
    },
    result,
    job: job ?? undefined
  };
}
