// MigraAI Engine transport — the extension's client for the unified engine
// facade (`/api/ai/*`) exposed by brain-service (see project_migraai_engine).
//
// vscode-free so the transport is unit-testable under plain `node --test`
// against a deterministic mock. The extension wires a vscode-backed config
// (settings URL/timeout, output-channel log) in a thin adapter.
//
// The client is deliberately model-agnostic: it forwards a capability spec and
// relays the engine's streamed answer + sanitized routing metadata. It NEVER
// falls back to the legacy `/chat` endpoint — an engine failure surfaces as a
// correlated PilotError so the caller can show a clear message.

import { REQUEST_ID_HEADER, newRequestId } from '@migrapilot/pilot-client';
import { PilotError, type PilotErrorCode } from '@migrapilot/pilot-client';

export interface MigraAiConfig {
  /** Base URL of the engine (brain-service), e.g. http://127.0.0.1:3988. */
  baseUrl(): string;
  timeoutMs(): number;
  log(message: string): void;
  /** Owner + workspace scope for memory isolation. Sent as X-Owner-Scope /
   * X-Workspace-Scope so the engine keeps conversations per-workspace. */
  scope?(): { owner: string; workspace: string };
}

export interface ConversationMeta {
  id: string;
  ownerScope: string;
  workspaceScope: string;
  title: string;
  memoryMode: 'off' | 'session' | 'durable';
  createdAt: number;
  updatedAt: number;
}

export interface StoredMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  status: 'complete' | 'partial' | 'failed';
  createdAt: number;
}

/** Capability spec sent to `/api/ai/chat`. The engine selects the model. */
export interface AiChatRequest {
  prompt?: string;
  messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  attachments?: Array<{ name: string; mimeType: string; dataBase64: string; sizeBytes?: number }>;
  /** Size tier hint: fast | balanced | deep. */
  tier?: 'fast' | 'balanced' | 'deep';
  /** Explicit model id the user pinned in the picker. The engine uses it verbatim
   * when it exists in the registry and meets the turn's hard requirements
   * (qualification-gated); otherwise it falls back to tier/capability selection. */
  model?: string;
  /** Legacy hints the engine also understands. */
  feature?: string;
  profile?: string;
  /** Soft/hard capability requirements. */
  needsReasoning?: boolean;
  preferCoding?: boolean;
  needsTools?: boolean;
  /** Slice 5: per-request execution-policy preference (server resolves). */
  policy?: string;
  conversationSummary?: string;
  selectionText?: string;
  activeFile?: string;
  workspaceRoot?: string;
  /** Server-side conversation memory: the engine owns durable history. */
  conversationId?: string;
  memoryPolicy?: { mode?: 'off' | 'session' | 'durable'; retrieve?: boolean; store?: boolean };
}

/** Sanitized routing metadata surfaced by the engine (no secrets/prompts). */
export interface AiRouting {
  model: string;
  provider: string;
  tier: string;
  reason: string;
  failedOver: string[];
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
}

export type AiStreamEvent =
  | { type: 'route'; routing: AiRouting }
  | { type: 'token'; text: string }
  | { type: 'done'; model?: string; provider?: string; tier?: string; usage?: AiUsage; failedOver?: string[] };

/** A single read-only tool step taken by the agentic answer loop. */
export interface AgenticStep {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  summary: string;
}

/** Streamed events from the agentic answer loop (`POST /api/ai/answer`, SSE). */
export type AnswerStreamEvent =
  | { type: 'route'; model: string }
  | { type: 'step'; step: AgenticStep }
  | { type: 'token'; text: string }
  | { type: 'done'; stepsUsed: number; model: string };

export interface AnswerRequest {
  prompt: string;
  workspaceRoot: string;
  /** `cloud` escalates to a faster/stronger model (opt-in). */
  tier?: 'local' | 'cloud';
  model?: string;
  maxSteps?: number;
}

export interface AiModel {
  id: string;
  provider: string;
  tier: string;
  capabilities: Record<string, boolean>;
  /** Parameter count in billions (for a human-readable size label). */
  paramCount?: number;
  /** Qualification lifecycle — only `approved` models are served under enforcement. */
  qualification?: { state?: string };
}

/** Read-only inspection op (mirror of the brain's inspect op set). `find` is a
 * filesystem name/path search; `search` is content (grep) search. */
export type InspectOp =
  | 'workspace_root' | 'list' | 'find' | 'search' | 'read'
  | 'git_status' | 'git_branch' | 'git_head' | 'git_remotes' | 'pkg_manager';

export type InspectErrorCode =
  | 'workspace_not_open' | 'scope_not_authorized' | 'tool_not_available'
  | 'policy_denied' | 'tool_execution_failed' | 'tool_execution_timed_out';

export interface InspectRequest {
  rootPath: string;
  op: InspectOp;
  path?: string;
  query?: string;
  /** `find` filter: only files, only directories, or any (default). */
  kind?: 'file' | 'dir' | 'any';
  limit?: number;
  startLine?: number;
  endLine?: number;
}

export type InspectResponse =
  | { ok: true; op: InspectOp; runner: 'local'; executionScope: 'local'; traceId: string; data: unknown }
  | { ok: false; op?: InspectOp; runner: 'local'; executionScope: 'local'; traceId: string; code: InspectErrorCode; error: string; remediation?: string };

/** Request for the local workspace-engineer loop (`POST /api/ai/engineer`). */
export interface EngineerRequest {
  rootPath: string;
  task: string;
  ecosystem?: boolean;
  /** Prior turns (oldest first) — the unified agent serves ordinary chat too,
   * so it carries the conversation the chat path used to hold. */
  history?: Array<{ role: 'user' | 'assistant'; text: string }>;
  tier?: string;
  /** Slice 5: per-request execution-policy preference (server resolves). */
  policy?: string;
}

/** SSE events from the engineer loop, kept loosely typed at the transport —
 * the chat layer switches on `event` and renders `data`. */
export interface EngineerStreamEvent {
  event: string;
  data: unknown;
}

/** Sanitized capability metadata from the engine (no implementation details). */
export interface ToolDescriptor {
  kind: string;
  id: string;
  displayName: string;
  description: string;
  category: string;
  requiredCapabilities: string[];
  readOnly: boolean;
  approvalRequired: boolean;
  supportsDryRun: boolean;
  supportsStreaming: boolean;
  inputSchemaVersion: number;
  outputSchemaVersion: number;
  available: boolean;
}

export interface ToolExecuteRequest {
  tool: string;
  input: unknown;
  /** Preview only — never mutates. */
  dryRun?: boolean;
  /** Single-use approval token from a prior `approval_required` response. */
  approvalId?: string;
}

/** Structured, versioned tool execution outcome. Clients switch on `status`. */
export type ToolExecuteResult =
  | { status: 'ok'; tool: string; result: unknown; requestId: string }
  | { status: 'dry_run'; tool: string; preview: unknown; requestId: string }
  | { status: 'approval_required'; tool: string; approvalId: string; preview: unknown; expiresAt: number; requestId: string }
  | { status: 'executed'; tool: string; result: unknown; approvalId?: string; requestId: string };

/** Sanitized agent metadata from the engine. */
export interface AgentDescriptor {
  kind: string;
  id: string;
  version: string;
  displayName: string;
  purpose: string;
  operationClasses: string[];
  requiredModelCapabilities: string[];
  requiredToolCapabilities: string[];
  readOnly: boolean;
  approvalRequired: boolean;
  resumable: boolean;
  cancellable: boolean;
  maxSteps: number;
  maxRuntimeMs: number;
  available: boolean;
  reason?: string;
}

export type AgentRunState =
  | 'CREATED' | 'PLANNING' | 'RUNNING' | 'WAITING_FOR_APPROVAL' | 'APPROVED'
  | 'RESUMING' | 'COMPLETED' | 'FAILED' | 'CANCEL_REQUESTED' | 'CANCELLED' | 'EXPIRED';

/** Sanitized run view — no approval material or raw tool inputs. */
export interface AgentRunView {
  runId: string;
  requestId: string;
  agentId: string;
  agentVersion: string;
  runtime: 'local' | 'pilot';
  state: AgentRunState;
  cancellation?: 'requested' | 'confirmed';
  steps: Array<{ stepId: string; kind: string; label: string; status: string }>;
  pendingAction?: { actionId: string; tool: string; summary: string };
  result?: unknown;
  error?: { code: string; message: string };
  createdAt: number;
  updatedAt: number;
  history: Array<{ at: number; state: AgentRunState }>;
}

/** The aggregated MigraAI Workspace view (mirrors the engine's WorkspaceView). */
export interface WorkspaceView {
  workspace: {
    id: string;
    name: string;
    root: string;
    gitRepo?: string;
    gitBranch?: string;
    memoryMode: 'off' | 'session' | 'durable';
    indexId?: string;
    lastSyncAt?: number;
    createdAt: number;
    updatedAt: number;
  };
  health: 'ready' | 'needs-approval' | 'needs-sync' | 'indexing' | 'degraded';
  index: { id?: string; version: number; state?: string; files: number; chunks: number; embeddingModel?: string; lastSyncAt?: number; pendingSync: boolean };
  memory: { mode: string; activeConversations: number };
  agents: string[];
  models: { coding: string[]; reasoning: string[]; general: string[]; vision: string[]; embedding: string[] };
  versions: {
    engineVersion: string;
    protocolVersion: number;
    schemaVersion: number;
    registryVersion: number;
    ragVersion: number;
    memoryVersion: number;
    qualificationVersion: number;
  };
}

/** Minimal workspace summary from the list endpoint. */
export interface WorkspaceSummary {
  id: string;
  name: string;
  root: string;
  gitBranch?: string;
  memoryMode: 'off' | 'session' | 'durable';
  lastSyncAt?: number;
}

/** Engine version contract (`GET /api/ai/version`). */
export type EngineVersionInfo = WorkspaceView['versions'];

const CHAT_PATH = '/api/ai/chat';
const MODELS_PATH = '/api/ai/models';
const TOOLS_PATH = '/api/ai/tools';
const AGENTS_PATH = '/api/ai/agents';
const WORKSPACES_PATH = '/api/ai/workspaces';

export class MigraAiClient {
  constructor(private readonly cfg: MigraAiConfig) {}

  private base(): string {
    return this.cfg.baseUrl().replace(/\/+$/, '');
  }

  /** Owner + workspace scope headers for memory isolation. */
  private scopeHeaders(): Record<string, string> {
    const s = this.cfg.scope?.();
    return s ? { 'x-owner-scope': s.owner, 'x-workspace-scope': s.workspace } : {};
  }

  // ── Conversation memory — the engine owns durable history ────────────────────

  async createConversation(params: { title?: string; memoryMode: 'off' | 'session' | 'durable' }, signal?: AbortSignal): Promise<ConversationMeta> {
    return this.jsonRequest('POST', '/api/ai/conversations', params, signal);
  }
  async listConversations(signal?: AbortSignal): Promise<{ conversations: ConversationMeta[] }> {
    return this.jsonRequest('GET', '/api/ai/conversations', undefined, signal);
  }
  async getConversation(id: string, signal?: AbortSignal): Promise<ConversationMeta> {
    return this.jsonRequest('GET', `/api/ai/conversations/${encodeURIComponent(id)}`, undefined, signal);
  }
  async renameConversation(id: string, title: string, signal?: AbortSignal): Promise<ConversationMeta> {
    return this.jsonRequest('PATCH', `/api/ai/conversations/${encodeURIComponent(id)}`, { title }, signal);
  }
  async deleteConversation(id: string, signal?: AbortSignal): Promise<{ ok: boolean }> {
    return this.jsonRequest('DELETE', `/api/ai/conversations/${encodeURIComponent(id)}`, undefined, signal);
  }
  /** Authoritative history from the engine — used to resume after a reconnect
   * instead of reconstructing history locally. */
  async getConversationMessages(id: string, signal?: AbortSignal): Promise<{ messages: StoredMessage[] }> {
    return this.jsonRequest('GET', `/api/ai/conversations/${encodeURIComponent(id)}/messages`, undefined, signal);
  }
  async summarizeConversation(id: string, signal?: AbortSignal): Promise<unknown> {
    return this.jsonRequest('POST', `/api/ai/conversations/${encodeURIComponent(id)}/summarize`, {}, signal);
  }

  /** GET /api/ai/models — the live capability catalog. */
  async getModels(signal?: AbortSignal): Promise<{ count: number; providers: string[]; models: AiModel[] }> {
    const requestId = newRequestId();
    const { signal: combined, done, timedOut } = this.withTimeout(signal);
    const url = `${this.base()}${MODELS_PATH}`;
    this.cfg.log(`GET ${url} [${requestId}]`);
    let res: Response;
    try {
      res = await fetch(url, { headers: { [REQUEST_ID_HEADER]: requestId }, signal: combined });
    } catch (err) {
      done();
      throw this.transportError(err, timedOut(), requestId);
    }
    done();
    if (!res.ok) throw this.httpError(res.status, requestId);
    return (await res.json()) as { count: number; providers: string[]; models: AiModel[] };
  }

  /** POST /api/ai/inspect — a MODEL-FREE, read-only local-runner inspection.
   * Returns the typed result/error envelope (does NOT throw on a typed error like
   * scope_not_authorized — the caller renders it). Throws a PilotError only on a
   * TRANSPORT failure (the local runner is unreachable → local_runner_unavailable). */
  async inspect(body: InspectRequest, signal?: AbortSignal): Promise<InspectResponse> {
    const requestId = newRequestId();
    const { signal: combined, done, timedOut } = this.withTimeout(signal);
    const url = `${this.base()}/api/ai/inspect`;
    this.cfg.log(`POST ${url} [${requestId}] (${body.op})`);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [REQUEST_ID_HEADER]: requestId, ...this.scopeHeaders() },
        body: JSON.stringify(body),
        signal: combined,
      });
    } catch (err) {
      done();
      // A transport failure is the local runner being unreachable — surface it as
      // such so the chat renders `local_runner_unavailable`, never a generic refusal.
      throw this.transportError(err, timedOut(), requestId);
    }
    done();
    try {
      return (await res.json()) as InspectResponse;
    } catch {
      throw new PilotError('SERVER_ERROR', 'The local runner returned an unreadable inspection response.', { requestId });
    }
  }

  /**
   * Stream a chat turn from the engine as SSE. Yields `route` (once the engine
   * commits a model, after any failover), then `token` frames, then `done`.
   * Aborting `signal` cancels the request; the engine stops without a `done`, so
   * a cancelled turn never produces a false completed answer.
   *
   * Any engine failure throws a correlated {@link PilotError} — there is NO
   * silent fallback to the legacy `/chat` endpoint.
   */
  async *chatStream(body: AiChatRequest, signal?: AbortSignal): AsyncGenerator<AiStreamEvent> {
    const requestId = newRequestId();
    const url = `${this.base()}${CHAT_PATH}`;
    this.cfg.log(`POST ${url} [${requestId}] (sse)`);
    const { signal: combined, reset, done, timedOut } = this.withTimeout(signal);

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
          [REQUEST_ID_HEADER]: requestId,
          ...this.scopeHeaders(),
        },
        body: JSON.stringify({ ...body, stream: true }),
        signal: combined,
      });
    } catch (err) {
      done();
      throw this.transportError(err, timedOut(), requestId);
    }
    if (!res.ok) {
      done();
      throw this.httpError(res.status, requestId);
    }
    if (!res.body) {
      done();
      throw new PilotError('SERVER_ERROR', 'Engine returned an empty stream.', { requestId });
    }

    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        reset(); // stream activity → push the inactivity deadline forward
        buffer += decoder.decode(chunk, { stream: true });
        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const parsed = parseSseFrame(frame);
          if (!parsed) continue;
          if (parsed.event === 'error') {
            const data = parsed.data as { code?: string; message?: string };
            throw new PilotError(mapEngineCode(data.code), 'The engine could not complete the request.', { requestId });
          }
          const ev = toStreamEvent(parsed);
          if (ev) yield ev;
        }
      }
    } catch (err) {
      if (err instanceof PilotError) throw err;
      if (isAbort(err)) throw this.mapAbort(timedOut(), requestId);
      throw new PilotError('NETWORK', 'Engine stream interrupted.', { requestId, cause: err });
    } finally {
      done();
    }
  }

  /**
   * Stream the AGENTIC ANSWER loop (`POST /api/ai/answer`, SSE). The model
   * gathers real workspace evidence with read-only tools before answering
   * (Copilot "agent mode"). Yields `route`, `step` (each tool call), `token`
   * (the streamed answer), then `done`. Uses ONLY the caller's abort signal —
   * no short client timeout — because a local multi-hop run can take minutes.
   */
  async *answerStream(body: AnswerRequest, signal?: AbortSignal): AsyncGenerator<AnswerStreamEvent> {
    const requestId = newRequestId();
    const url = `${this.base()}/api/ai/answer`;
    this.cfg.log(`POST ${url} [${requestId}] (agentic sse)`);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
          [REQUEST_ID_HEADER]: requestId,
          ...this.scopeHeaders(),
        },
        body: JSON.stringify({ ...body, stream: true }),
        signal,
      });
    } catch (err) {
      if (isAbort(err)) throw new PilotError('CANCELLED', 'Agent run cancelled.', { requestId });
      throw new PilotError('NETWORK', 'The local runner is unreachable.', { requestId, retriable: true, cause: err });
    }
    if (!res.ok) throw this.httpError(res.status, requestId);
    if (!res.body) throw new PilotError('SERVER_ERROR', 'Agent run returned an empty stream.', { requestId });

    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const parsed = parseSseFrame(frame);
          if (!parsed) continue;
          if (parsed.event === 'error') {
            const data = parsed.data as { message?: string };
            throw new PilotError('SERVER_ERROR', data.message ?? 'The agent run failed.', { requestId });
          }
          const d = parsed.data as Record<string, unknown>;
          if (parsed.event === 'route') yield { type: 'route', model: String(d.model ?? '') };
          else if (parsed.event === 'step') yield { type: 'step', step: d.step as AgenticStep };
          else if (parsed.event === 'token') yield { type: 'token', text: String(d.text ?? '') };
          else if (parsed.event === 'done') yield { type: 'done', stepsUsed: Number(d.stepsUsed ?? 0), model: String(d.model ?? '') };
        }
      }
    } catch (err) {
      if (err instanceof PilotError) throw err;
      if (isAbort(err)) throw new PilotError('CANCELLED', 'Agent run cancelled.', { requestId });
      throw new PilotError('NETWORK', 'Agent stream interrupted.', { requestId, cause: err });
    }
  }

  /**
   * Stream a LOCAL workspace-engineer run (`POST /api/ai/engineer`) as SSE.
   * Slice 2: ordinary engineering requests route here — never to the pilot
   * runtime, so disabled delegation cannot block local work. Events: `route`,
   * `step`, `proposal`, `final`, `error`, `done`.
   */
  async *engineerStream(body: EngineerRequest, signal?: AbortSignal): AsyncGenerator<EngineerStreamEvent> {
    const requestId = newRequestId();
    const url = `${this.base()}/api/ai/engineer`;
    this.cfg.log(`POST ${url} [${requestId}] (sse)`);
    // Uses ONLY the caller's abort signal — NO short client timeout — because a
    // local build is a multi-step, model-in-the-loop run that can take MINUTES
    // (the first tool step alone can exceed the 30s default on a large local
    // coding model, which spuriously aborted with "Engine request timed out"
    // before any tool ran). The user cancels via the chat Stop button; a
    // slow-but-active build must never be killed as a false timeout. Same
    // rationale as the /deep answer stream.
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
          [REQUEST_ID_HEADER]: requestId,
          ...this.scopeHeaders(),
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (isAbort(err)) throw new PilotError('CANCELLED', 'Engineer run cancelled.', { requestId });
      throw this.transportError(err, false, requestId);
    }
    if (!res.ok) {
      throw await this.toolHttpError(res, requestId);
    }
    if (!res.body) {
      throw new PilotError('SERVER_ERROR', 'Engineer returned an empty stream.', { requestId });
    }
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const parsed = parseSseFrame(frame);
          if (!parsed) continue;
          if (parsed.event === 'done') return;
          yield { event: parsed.event, data: parsed.data } as EngineerStreamEvent;
        }
      }
    } catch (err) {
      if (err instanceof PilotError) throw err;
      if (isAbort(err)) throw new PilotError('CANCELLED', 'Engineer run cancelled.', { requestId });
      throw new PilotError('NETWORK', 'Engineer stream interrupted.', { requestId, cause: err });
    }
  }

  /** GET /api/ai/tools — the capability catalog (sanitized metadata). */
  async listTools(
    filter: { category?: string; readOnly?: boolean; includeUnavailable?: boolean } = {},
    signal?: AbortSignal,
  ): Promise<{ count: number; tools: ToolDescriptor[] }> {
    const params = new URLSearchParams();
    if (filter.category) params.set('category', filter.category);
    if (filter.readOnly !== undefined) params.set('readOnly', String(filter.readOnly));
    if (filter.includeUnavailable) params.set('includeUnavailable', 'true');
    const qs = params.toString();
    return this.jsonRequest<{ count: number; tools: ToolDescriptor[] }>('GET', `${TOOLS_PATH}${qs ? `?${qs}` : ''}`, undefined, signal);
  }

  /** GET /api/ai/tools/:id — one capability's metadata. */
  async getTool(id: string, signal?: AbortSignal): Promise<ToolDescriptor> {
    return this.jsonRequest<ToolDescriptor>('GET', `${TOOLS_PATH}/${encodeURIComponent(id)}`, undefined, signal);
  }

  /**
   * POST /api/ai/tools — submit a tool request to the ENGINE for execution. The
   * engine validates input, checks availability, dispatches, and enforces the
   * approval lifecycle. The extension never executes tools itself and never
   * retries model/tool selection. Failures throw a correlated {@link PilotError}.
   */
  async executeTool(request: ToolExecuteRequest, signal?: AbortSignal): Promise<ToolExecuteResult> {
    const body = await this.jsonRequest<Record<string, unknown>>('POST', TOOLS_PATH, request, signal);
    return body as unknown as ToolExecuteResult;
  }

  /** Convenience for read-only tools: execute and return the typed `.result`. */
  async runReadOnlyTool<T>(tool: string, input: unknown, signal?: AbortSignal): Promise<T> {
    const res = await this.executeTool({ tool, input }, signal);
    if (res.status !== 'ok' && res.status !== 'executed') {
      throw new PilotError('SERVER_ERROR', `Tool ${tool} did not return a result.`);
    }
    return (res as { result: T }).result;
  }

  // ── Agents — the engine owns orchestration; clients never call pilot-api ─────

  /** GET /api/ai/agents — the agent catalog. */
  async listAgents(
    filter: { operationClass?: string; readOnly?: boolean } = {},
    signal?: AbortSignal,
  ): Promise<{ count: number; agents: AgentDescriptor[] }> {
    const params = new URLSearchParams();
    if (filter.operationClass) params.set('operationClass', filter.operationClass);
    if (filter.readOnly !== undefined) params.set('readOnly', String(filter.readOnly));
    const qs = params.toString();
    return this.jsonRequest('GET', `${AGENTS_PATH}${qs ? `?${qs}` : ''}`, undefined, signal);
  }

  /** GET /api/ai/agents/:id — one agent's metadata. */
  async getAgent(id: string, signal?: AbortSignal): Promise<AgentDescriptor> {
    return this.jsonRequest('GET', `${AGENTS_PATH}/${encodeURIComponent(id)}`, undefined, signal);
  }

  /** POST /api/ai/agents/runs — create + start a run. `idempotencyKey` makes a
   * retry reconcile to the same run rather than starting a second. */
  async createAgentRun(
    req: { agentId: string; input: unknown; idempotencyKey?: string },
    signal?: AbortSignal,
  ): Promise<AgentRunView> {
    return this.jsonRequest('POST', `${AGENTS_PATH}/runs`, { agentId: req.agentId, input: req.input }, signal, req.idempotencyKey);
  }

  /** GET /api/ai/agents/runs/:runId — reconcile run state (never mutates). */
  async getAgentRun(runId: string, signal?: AbortSignal): Promise<AgentRunView> {
    return this.jsonRequest('GET', `${AGENTS_PATH}/runs/${encodeURIComponent(runId)}`, undefined, signal);
  }

  /** POST /api/ai/agents/runs/:runId/resume — approve or reject a pending action. */
  async resumeAgentRun(runId: string, decision: 'approve' | 'reject', signal?: AbortSignal): Promise<AgentRunView> {
    return this.jsonRequest('POST', `${AGENTS_PATH}/runs/${encodeURIComponent(runId)}/resume`, { decision }, signal);
  }

  /** POST /api/ai/agents/runs/:runId/cancel — request run cancellation. Aborting a
   * local observe does NOT cancel a run; only this explicit call does. */
  async cancelAgentRun(runId: string, signal?: AbortSignal): Promise<AgentRunView> {
    return this.jsonRequest('POST', `${AGENTS_PATH}/runs/${encodeURIComponent(runId)}/cancel`, {}, signal);
  }

  // ── Workspaces — the product object; the engine owns index/memory/health ─────

  /** POST /api/ai/workspaces — open (register/reuse; idempotent per scope). The
   * `root` is the authoritative workspace root chosen by the client (never an
   * inferred subfolder). Returns the aggregated view. */
  async openWorkspace(params: { root: string; name?: string; memoryMode?: 'off' | 'session' | 'durable' }, signal?: AbortSignal): Promise<WorkspaceView> {
    return this.jsonRequest('POST', WORKSPACES_PATH, params, signal);
  }

  /** GET /api/ai/workspaces — scoped list (minimal fields; IDs stay internal). */
  async listWorkspaces(signal?: AbortSignal): Promise<{ workspaces: WorkspaceSummary[] }> {
    return this.jsonRequest('GET', WORKSPACES_PATH, undefined, signal);
  }

  /** GET /api/ai/workspaces/:id — the authoritative aggregated view. */
  async getWorkspace(id: string, signal?: AbortSignal): Promise<WorkspaceView> {
    return this.jsonRequest('GET', `${WORKSPACES_PATH}/${encodeURIComponent(id)}`, undefined, signal);
  }

  /** POST /api/ai/workspaces/:id/sync — (incremental) re-index. Returns the
   * refreshed view; the caller reads `health`/`index` from it rather than
   * assuming success means "ready". Never auto-approves. */
  async syncWorkspace(id: string, signal?: AbortSignal): Promise<WorkspaceView> {
    return this.jsonRequest('POST', `${WORKSPACES_PATH}/${encodeURIComponent(id)}/sync`, {}, signal);
  }

  /** POST /api/ai/workspaces/:id/rebuild — full re-index from scratch. The new
   * index is experimental and must be re-approved. Returns the refreshed view. */
  async rebuildWorkspace(id: string, signal?: AbortSignal): Promise<WorkspaceView> {
    return this.jsonRequest('POST', `${WORKSPACES_PATH}/${encodeURIComponent(id)}/rebuild`, {}, signal);
  }

  /** POST /api/ai/workspaces/:id/approve — approve the EXACT index version the
   * caller observed. If the index changed since (sync/rebuild), the engine
   * refuses with a stale-version error (surfaced as INVALID_STATE). */
  async approveWorkspaceIndex(id: string, indexVersion: number, signal?: AbortSignal): Promise<WorkspaceView> {
    return this.jsonRequest('POST', `${WORKSPACES_PATH}/${encodeURIComponent(id)}/approve`, { indexVersion }, signal);
  }

  /** PATCH /api/ai/workspaces/:id — update name / memory mode / prefs. */
  async patchWorkspace(id: string, changes: { name?: string; memoryMode?: 'off' | 'session' | 'durable' }, signal?: AbortSignal): Promise<WorkspaceView> {
    return this.jsonRequest('PATCH', `${WORKSPACES_PATH}/${encodeURIComponent(id)}`, changes, signal);
  }

  /** DELETE /api/ai/workspaces/:id — remove the workspace registration + its
   * index. Conversation/durable memory is scope-owned and NOT removed here. */
  async deleteWorkspace(id: string, signal?: AbortSignal): Promise<{ ok: boolean }> {
    return this.jsonRequest('DELETE', `${WORKSPACES_PATH}/${encodeURIComponent(id)}`, undefined, signal);
  }

  /** GET /api/ai/version — the engine version contract. */
  async getVersion(signal?: AbortSignal): Promise<EngineVersionInfo> {
    return this.jsonRequest('GET', '/api/ai/version', undefined, signal);
  }

  // ── transport helpers (mirror pilotApiClient conventions) ────────────────────

  /** JSON request with correlation, timeout, and PilotError mapping (no auth —
   * the local engine is trusted on loopback). `idempotencyKey` is sent as the
   * Idempotency-Key header when present. */
  private async jsonRequest<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, jsonBody: unknown, signal?: AbortSignal, idempotencyKey?: string): Promise<T> {
    const requestId = newRequestId();
    const url = `${this.base()}${path}`;
    this.cfg.log(`${method} ${url} [${requestId}]`);
    const { signal: combined, done, timedOut } = this.withTimeout(signal);
    let res: Response;
    try {
      const hasBody = method === 'POST' || method === 'PATCH';
      res = await fetch(url, {
        method,
        headers: {
          ...(hasBody ? { 'content-type': 'application/json' } : {}),
          [REQUEST_ID_HEADER]: requestId,
          ...this.scopeHeaders(),
          ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
        },
        body: hasBody ? JSON.stringify(jsonBody ?? {}) : undefined,
        signal: combined,
      });
    } catch (err) {
      done();
      throw this.transportError(err, timedOut(), requestId);
    }
    done();
    if (!res.ok) {
      throw await this.toolHttpError(res, requestId);
    }
    return (await res.json()) as T;
  }

  /** Map an engine tool-boundary error → correlated PilotError, preferring the
   * structured `code` over the HTTP status. Never surfaces raw provider bodies —
   * only the engine's own sanitized error text and schema issues are relayed. */
  private async toolHttpError(res: Response, requestId: string): Promise<PilotError> {
    let serverCode: string | undefined;
    let serverError: string | undefined;
    let issues: Array<{ path?: string; message?: string }> | undefined;
    try {
      const body = (await res.json()) as { code?: string; error?: string; issues?: Array<{ path?: string; message?: string }> };
      serverCode = body.code;
      serverError = typeof body.error === 'string' ? body.error : undefined;
      issues = Array.isArray(body.issues) ? body.issues : undefined;
    } catch {
      /* non-JSON */
    }
    let code: PilotErrorCode;
    switch (serverCode) {
      case 'UNKNOWN_TOOL':
      case 'CAPABILITY_DENIED':
        code = 'CAPABILITY_MISSING';
        break;
      case 'INVALID_STATE':
        code = 'INVALID_STATE';
        break;
      case 'INVALID_INPUT': {
        // Truthful validation failure: relay the engine's message + schema
        // issues (engine-authored zod paths/messages, sanitized by construction)
        // instead of collapsing to a generic SERVER_ERROR.
        const detail = (issues ?? [])
          .map((i) => [i.path, i.message].filter(Boolean).join(': '))
          .filter(Boolean)
          .join('; ')
          .slice(0, 500);
        return new PilotError('INVALID_INPUT', `${serverError ?? 'The request input was invalid.'}${detail ? ` (${detail})` : ''}`, {
          httpStatus: res.status,
          requestId,
        });
      }
      case 'TOOL_FAILED':
        code = 'SERVER_ERROR';
        break;
      default:
        if (res.status === 404 || res.status === 403) code = 'CAPABILITY_MISSING';
        else if (res.status === 409) code = 'INVALID_STATE';
        else if (res.status === 503) code = 'NOT_READY';
        else code = 'SERVER_ERROR';
    }
    return new PilotError(code, `Engine tool responded ${res.status}${serverCode ? ` (${serverCode})` : ''}.`, {
      httpStatus: res.status,
      requestId,
    });
  }

  private withTimeout(signal: AbortSignal | undefined): { signal: AbortSignal; reset: () => void; done: () => void; timedOut: () => boolean } {
    const controller = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, this.cfg.timeoutMs());
    };
    arm();
    const onAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    return {
      signal: controller.signal,
      // Reset the deadline on stream activity: for an SSE response the timeout must
      // measure SILENCE from the Pilot service, not the total time to finish. Each
      // received chunk proves the service is alive, so a long-but-active answer must
      // never be aborted as a spurious "didn't respond in time".
      reset: () => {
        if (!timedOut) {
          clearTimeout(timer);
          arm();
        }
      },
      done: () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      },
      timedOut: () => timedOut,
    };
  }

  private mapAbort(timedOut: boolean, requestId: string): PilotError {
    return timedOut
      ? new PilotError('TIMEOUT', 'Engine request timed out.', { retriable: true, requestId })
      : new PilotError('CANCELLED', 'Request cancelled.', { requestId });
  }

  private transportError(err: unknown, timedOut: boolean, requestId: string): PilotError {
    if (isAbort(err)) return this.mapAbort(timedOut, requestId);
    return new PilotError('NETWORK', `Could not reach the MigraAI engine at ${this.base()}.`, { requestId, cause: err });
  }

  /** Map an engine HTTP status to a correlated PilotError. 404 = the `/api/ai`
   * facade is absent/incompatible → clear error, never a legacy fallback. */
  private httpError(status: number, requestId: string): PilotError {
    let code: PilotErrorCode;
    if (status === 404 || status === 501) code = 'CAPABILITY_MISSING';
    else if (status === 503) code = 'NOT_READY';
    else if (status === 429) code = 'RATE_LIMITED';
    else code = 'SERVER_ERROR';
    return new PilotError(code, `Engine responded ${status}.`, { httpStatus: status, retriable: status === 429 || status === 503, requestId });
  }
}

function mapEngineCode(code: string | undefined): PilotErrorCode {
  switch (code) {
    case 'NO_MODEL':
      return 'CAPABILITY_MISSING';
    case 'BAD_REQUEST':
      return 'SERVER_ERROR';
    default:
      return 'SERVER_ERROR';
  }
}

function toStreamEvent(frame: { event: string; data: unknown }): AiStreamEvent | null {
  const d = (frame.data ?? {}) as Record<string, unknown>;
  if (frame.event === 'route') {
    return {
      type: 'route',
      routing: {
        model: String(d.model ?? ''),
        provider: String(d.provider ?? ''),
        tier: String(d.tier ?? ''),
        reason: String(d.reason ?? ''),
        failedOver: Array.isArray(d.failedOver) ? (d.failedOver as string[]) : [],
      },
    };
  }
  if (frame.event === 'token') {
    return { type: 'token', text: String(d.text ?? '') };
  }
  if (frame.event === 'done') {
    return {
      type: 'done',
      model: d.model as string | undefined,
      provider: d.provider as string | undefined,
      tier: d.tier as string | undefined,
      usage: d.usage as AiUsage | undefined,
      failedOver: Array.isArray(d.failedOver) ? (d.failedOver as string[]) : undefined,
    };
  }
  return null;
}

function parseSseFrame(frame: string): { event: string; data: unknown } | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trimStart());
  }
  if (dataLines.length === 0) return null;
  const dataStr = dataLines.join('\n');
  let data: unknown = dataStr;
  try {
    data = JSON.parse(dataStr);
  } catch {
    /* leave as string */
  }
  return { event, data };
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}
