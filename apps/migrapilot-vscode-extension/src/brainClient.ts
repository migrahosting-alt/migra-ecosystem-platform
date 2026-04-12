import * as vscode from "vscode";

export type RunnerTarget = "auto" | "local" | "server";
export type EnvironmentName = "dev" | "stage" | "staging" | "prod" | "test";

export type BrainHealthState = "connected" | "starting" | "offline" | "misconfigured";

export interface BrainHealthSnapshot {
  ok: boolean;
  state: BrainHealthState;
  url: string;
  service: string;
  status: string;
  detail: string;
}

interface ExecutePayload {
  toolName: string;
  toolInput?: Record<string, unknown>;
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

export interface BrainClientConfig {
  baseUrl: string;
  runnerTarget: RunnerTarget;
  environment: EnvironmentName;
  operatorId?: string;
  authToken?: string;
  completionsApiKey?: string;
}

function isLocalHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(onTimeout()), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function formatConnectionError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function normalizeBrainUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    throw new Error("MigraPilot brainUrl is empty. Set migrapilot.brainUrl in VS Code settings.");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`MigraPilot brainUrl is invalid: ${trimmed}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`MigraPilot brainUrl must use http or https: ${trimmed}`);
  }

  return parsed.toString().replace(/\/$/, "");
}

export function isLocalBrainUrl(baseUrl: string): boolean {
  try {
    const url = new URL(normalizeBrainUrl(baseUrl));
    return isLocalHost(url.hostname);
  } catch {
    return false;
  }
}

export function isBrainConnectionError(error: unknown): boolean {
  const text = formatConnectionError(error);
  return /fetch failed|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|network|invalid:|brainUrl|empty/i.test(text);
}

export function getConfiguredAuthToken(config: BrainClientConfig): string | undefined {
  const token = config.authToken?.trim();
  return token ? token : undefined;
}

export function getRemoteAuthError(baseUrl: string): string {
  return `MigraPilot auth token is required for ${baseUrl}. Set migrapilot.authToken and migrapilot.brainUrl in VS Code settings.`;
}

export function getAuthorizationHeader(config: BrainClientConfig): string | undefined {
  const token = getConfiguredAuthToken(config);
  if (token) {
    return `Bearer ${token}`;
  }
  if (isLocalBrainUrl(config.baseUrl)) {
    return undefined;
  }
  throw new Error(getRemoteAuthError(config.baseUrl));
}

async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 4000
): Promise<any> {
  const response = await withTimeout(fetch(url, init), timeoutMs, () => new Error(`Timed out after ${timeoutMs}ms`));

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message = payload?.error?.message ?? payload?.error ?? `HTTP ${response.status}`;
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }

  return payload;
}

export async function probeBrainHealth(
  config: BrainClientConfig,
  timeoutMs = 4000
): Promise<BrainHealthSnapshot> {
  let baseUrl = config.baseUrl;
  try {
    baseUrl = normalizeBrainUrl(config.baseUrl);
  } catch (error) {
    return {
      ok: false,
      state: "misconfigured",
      url: config.baseUrl,
      service: "pilot-api",
      status: "invalid_config",
      detail: formatConnectionError(error),
    };
  }

  const headers: Record<string, string> = { "content-type": "application/json" };
  try {
    const authorization = getAuthorizationHeader({ ...config, baseUrl });
    if (authorization) {
      headers.authorization = authorization;
    }
  } catch (error) {
    return {
      ok: false,
      state: "misconfigured",
      url: baseUrl,
      service: "pilot-api",
      status: "auth_required",
      detail: formatConnectionError(error),
    };
  }

  try {
    const ready = await fetchJsonWithTimeout(`${baseUrl}/health/ready`, { method: "GET", headers }, timeoutMs);
    return {
      ok: Boolean(ready?.ok),
      state: ready?.ok ? "connected" : "starting",
      url: baseUrl,
      service: ready?.service ?? "pilot-api",
      status: ready?.status ?? "ready",
      detail: ready?.db === "connected"
        ? `Connected to ${ready?.service ?? "pilot-api"}`
        : `Health endpoint reachable at ${baseUrl}`,
    };
  } catch (readyError) {
    try {
      const live = await fetchJsonWithTimeout(`${baseUrl}/health`, { method: "GET", headers }, timeoutMs);
      return {
        ok: false,
        state: "starting",
        url: baseUrl,
        service: live?.service ?? "pilot-api",
        status: live?.status ?? "live_only",
        detail: `Reached ${baseUrl}, but readiness is not passing yet.`,
      };
    } catch {
      return {
        ok: false,
        state: "offline",
        url: baseUrl,
        service: "pilot-api",
        status: "unreachable",
        detail: `MigraPilot could not reach ${baseUrl}: ${formatConnectionError(readyError)}`,
      };
    }
  }
}

export class BrainClient {
  constructor(private readonly config: BrainClientConfig) {}

  async chat(message: string, conversationId?: string): Promise<any> {
    const streamed = await this.streamChat({
      message,
      conversationId,
      dryRun: false,
    });

    return {
      ok: true,
      data: {
        conversationId: streamed.conversationId,
        assistant: {
          content: streamed.content,
        },
        usage: streamed.usage,
      }
    };
  }

  async health(timeoutMs = 4000): Promise<BrainHealthSnapshot> {
    return probeBrainHealth(this.config, timeoutMs);
  }

  async execute(payload: ExecutePayload): Promise<any> {
    return this.request("/api/execute", {
      method: "POST",
      body: {
        runnerTarget: payload.runnerTarget ?? this.config.runnerTarget,
        environment: payload.environment ?? this.config.environment,
        operator: payload.operator,
        ...payload
      }
    });
  }

  async missionStart(payload: Record<string, unknown>): Promise<any> {
    return this.request("/api/mission/start", { method: "POST", body: payload });
  }

  async missionStep(payload: Record<string, unknown>): Promise<any> {
    return this.request("/api/mission/step", { method: "POST", body: payload });
  }

  async missionGet(missionId: string): Promise<any> {
    return this.request(`/api/mission/${missionId}`);
  }

  async missionReport(missionId: string): Promise<any> {
    return this.request(`/api/mission/${missionId}/report`);
  }

  async repoDiff(path?: string): Promise<any> {
    const params = new URLSearchParams();
    if (path) {
      params.set("path", path);
    }
    return this.request(`/api/repo/diff${params.toString() ? `?${params}` : ""}`);
  }

  /**
   * Search the workspace codebase via the Brain API's repo search endpoint (ripgrep).
   * Requires auth — generates a dev JWT automatically.
   */
  async repoSearch(query: string, globs?: string[], limit?: number): Promise<any> {
    const base = this.getBaseUrl();
    const headers: Record<string, string> = { "content-type": "application/json" };

    const authorization = getAuthorizationHeader(this.config);
    if (authorization) {
      headers["authorization"] = authorization;
    }

    const response = await fetch(`${base}/api/pilot/repo/search`, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, globs, limit }),
    });

    let payload: any = null;
    try {
      payload = await response.json();
    } catch { /* ignore */ }

    if (!response.ok || payload?.ok === false) {
      const message = payload?.error?.message ?? payload?.error ?? `HTTP ${response.status}`;
      throw new Error(typeof message === "string" ? message : JSON.stringify(message));
    }

    return payload;
  }
  /**
   * Request an inline completion from the Brain API.
   * Returns the completion string, or null if the server returns no suggestion.
   * Pass an AbortSignal to cancel an in-flight request.
   */
  async complete(
    ctx: {
      prefix: string;
      suffix: string;
      languageId: string;
      relativeFilePath: string;
      projectName: string;
      openTabs: string[];
      maxTokens?: number;
    },
    signal?: AbortSignal
  ): Promise<string | null> {
    const base = this.getBaseUrl();
    const headers: Record<string, string> = { "content-type": "application/json" };
    const authorization = getAuthorizationHeader(this.config);
    if (authorization) {
      headers["authorization"] = authorization;
    }
    if (this.config.completionsApiKey) {
      headers["x-ops-api-token"] = this.config.completionsApiKey;
    }
    const response = await fetch(`${base}/api/complete`, {
      method: "POST",
      headers,
      body: JSON.stringify(ctx),
      signal,
    });

    let payload: any = null;
    try {
      payload = await response.json();
    } catch {
      // ignore
    }

    if (!response.ok || payload?.ok === false) {
      const message = payload?.error?.message ?? `HTTP ${response.status}`;
      throw new Error(message);
    }

    // Accept either { completion: string } or { text: string }
    const text: string | undefined = payload?.completion ?? payload?.text;
    return typeof text === "string" && text.length > 0 ? text : null;
  }

  private getBaseUrl(): string {
    return normalizeBrainUrl(this.config.baseUrl);
  }

  private async streamChat(payload: {
    message: string;
    conversationId?: string;
    provider?: string;
    history?: Array<{ role: "user" | "assistant"; text: string }>;
    dryRun: boolean;
  }): Promise<{ content: string; conversationId?: string; usage?: unknown }> {
    const base = this.getBaseUrl();
    const headers: Record<string, string> = { "content-type": "application/json" };
    const authorization = getAuthorizationHeader(this.config);
    if (authorization) {
      headers.authorization = authorization;
    }

    const response = await fetch(`${base}/api/pilot/chat/stream`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
    }

    if (!response.body) {
      throw new Error("No response body (streaming not supported)");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let conversationId = payload.conversationId;
    let usage: unknown;
    let content = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      let eventType = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) {
          eventType = line.slice(7).trim();
          continue;
        }

        if (!line.startsWith("data: ")) {
          if (line === "") {
            eventType = "";
          }
          continue;
        }

        let data: any;
        try {
          data = JSON.parse(line.slice(6));
        } catch {
          continue;
        }

        if (eventType === "conversation" && data?.conversationId) {
          conversationId = data.conversationId;
        } else if (eventType === "token" && typeof data?.text === "string") {
          content += data.text;
        } else if (eventType === "usage") {
          usage = data;
        } else if (eventType === "error") {
          throw new Error(data?.message ?? "Chat stream failed");
        }
      }
    }

    return { content, conversationId, usage };
  }

  private async request(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<any> {
    const base = this.getBaseUrl();
    const headers: Record<string, string> = {
      "content-type": "application/json"
    };
    const authorization = getAuthorizationHeader(this.config);
    if (authorization) {
      headers["authorization"] = authorization;
    }

    const response = await fetch(`${base}${path}`, {
      method: init?.method ?? "GET",
      headers,
      body: init?.body ? JSON.stringify(init.body) : undefined
    });

    let payload: any = null;
    try {
      payload = await response.json();
    } catch {
      // ignore
    }

    if (!response.ok || payload?.ok === false) {
      const message = payload?.error?.message ?? `HTTP ${response.status}`;
      throw new Error(message);
    }

    return payload;
  }
}

export function getBrainClientConfig(): BrainClientConfig {
  const config = vscode.workspace.getConfiguration("migrapilot");
  const baseUrl = config.get<string>("brainUrl", "http://127.0.0.1:3377").trim();
  const runnerTarget = config.get<RunnerTarget>("runnerTarget", "auto");
  const environment = config.get<EnvironmentName>("environment", "dev");
  const operatorId = config.get<string>("operatorId", "").trim();
  const authToken = config.get<string>("authToken", "").trim();
  const completionsApiKey = config.get<string>("completions.apiKey", "").trim();

  return {
    baseUrl,
    runnerTarget,
    environment,
    operatorId: operatorId || undefined,
    authToken: authToken || undefined,
    completionsApiKey: completionsApiKey || undefined,
  };
}
