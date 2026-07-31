import * as vscode from 'vscode';
import type {
  ChatTurnRequest,
  ChatTurnResponse,
  HealthResponse,
  RetrieveRequest,
  RetrieveResponse,
  RouteRequest,
  RouteResponse,
} from '@migrapilot/shared-types';

import { BrainConnectionState, type ConnectionReadiness } from './brainConnection.js';
import { runBrainOperation, type BrainOperationOutcome, type FetchLike } from './brainTransport.js';
import type { ExecutionRecord, FailureCategory } from './executionState.js';

/**
 * A Brain operation that did not reach observed terminal success.
 *
 * Carries the full authoritative record, so a caller can report the OBSERVED
 * category rather than "something went wrong". Failure is surfaced as a throw so
 * that a caller which ignores it crashes loudly — the safe direction. A silent
 * fallthrough into success is the one outcome this type makes impossible.
 */
export class BrainOperationError extends Error {
  constructor(
    readonly record: ExecutionRecord,
    readonly category: FailureCategory | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'BrainOperationError';
  }
}

/** Success is unwrapped ONLY when the machine reported observed terminal evidence. */
function unwrap<T>(outcome: BrainOperationOutcome<T>): T {
  if (outcome.ok && outcome.value !== undefined) return outcome.value;
  throw new BrainOperationError(outcome.record, outcome.record.failureCategory, outcome.statusLine);
}

// APPROVED BRAIN TRANSPORT ADAPTER.
//
// This module is the ONLY production code permitted to reach the Brain. Every request
// runs through `runBrainOperation()`, so it is governed by the truthful execution
// model: nothing dispatches until its precondition is confirmed, success is emitted
// only on observed terminal evidence, and failures carry a structured category rather
// than a generic Error.
//
// `scripts/check-brain-transport.mjs` fails the build if a direct Brain-targeting
// `fetch()` appears anywhere else in production source.
//
// Health is deliberately NOT an operation: it uses the same transport primitive and
// the same classifier, but writes to a separate BrainConnectionState so a routine poll
// can never rewrite a completed, failed, cancelled or running operation record.

/** `GET /health` as the engine actually serves it. The extra blocks are optional
 * because an older brain may not report them; consumers must handle absence. */
export interface BrainHealthDetail extends HealthResponse {
  readonly readiness?: {
    process?: string;
    inferenceProviders?: string;
    persistence?: string;
    memory?: string;
    rag?: string;
    schemaVersion?: number;
    migrationState?: string;
    detail?: string;
  };
  readonly operational?: {
    status?: string;
    reachable?: boolean;
    schemaCurrent?: boolean;
    schemaVersion?: number;
    integrity?: string;
    retentionWorker?: string;
    writeLatencyMs?: number | null;
    storageBytes?: number | null;
  };
}

/** RETRY POLICY — explicit, because an implicit retry on a consequential action can
 * duplicate real work.
 *
 *  consequential (route/chat/tool)  never retried
 *  terminal_state_unverified        NEVER retried automatically: a response was not
 *                                   proven absent, so the server may already have
 *                                   performed the work
 *  health                           bounded retries permitted (see healthRetries)
 *  idempotent reads (retrieve)      retried only when explicitly configured
 *
 * Cancellation stops pending retries; each attempt appends its own transport-attempt
 * entry under the SAME operation id; a late result from a superseded attempt is
 * discarded by the state machine. */
export interface BrainRetryPolicy {
  readonly consequential: 0;
  readonly health: number;
  readonly idempotentReads: number;
}

export const DEFAULT_RETRY_POLICY: BrainRetryPolicy = {
  consequential: 0,
  health: 2,
  idempotentReads: 0,
};

let operationCounter = 0;
function nextOperationId(action: string): string {
  operationCounter += 1;
  return `${action}-${Date.now().toString(36)}-${operationCounter}`;
}

export class BrainClient {
  private readonly connection: BrainConnectionState;

  constructor(
    private readonly output: vscode.OutputChannel,
    private readonly fetchImpl?: FetchLike,
    private readonly retryPolicy: BrainRetryPolicy = DEFAULT_RETRY_POLICY,
  ) {
    this.connection = new BrainConnectionState(this.baseUrl);
  }

  get baseUrl(): string {
    const config = vscode.workspace.getConfiguration('migrapilot');
    return String(config.get('brainUrl', 'http://127.0.0.1:3988')).replace(/\/$/, '');
  }

  /** Configurable, replacing the former hard-coded 1500ms probe timeout. */
  get timeoutMs(): number {
    const config = vscode.workspace.getConfiguration('migrapilot');
    return Number(config.get('brainTimeoutMs', 30_000));
  }

  get connectionTimeoutMs(): number {
    const config = vscode.workspace.getConfiguration('migrapilot');
    return Number(config.get('brainConnectionTimeoutMs', 5_000));
  }

  /** Current readiness — derived only from observed probes. */
  get readiness(): ConnectionReadiness {
    return this.connection.readiness;
  }

  connectionStatusLine(): string {
    return this.connection.statusLine();
  }

  /**
   * Probe readiness. Updates the CONNECTION record only.
   *
   * Bounded retries are allowed here because a health check is idempotent and
   * performs no work.
   */
  async health(signal?: AbortSignal): Promise<HealthResponse> {
    const attempts = this.retryPolicy.health + 1;
    let last: BrainOperationOutcome<BrainHealthDetail> | undefined;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (signal?.aborted) break; // cancellation stops pending retries
      this.connection.probeStarted();
      last = await this.dispatch<BrainHealthDetail>('health', '/health', undefined, 'GET', {
        timeoutMs: this.connectionTimeoutMs,
        ...(signal ? { signal } : {}),
      });
      if (last.ok && last.value) {
        this.connection.probeSucceeded();
        return last.value;
      }
      const category = last.record.failureCategory;
      this.connection.probeFailed({
        ...(category === 'connection_refused' ? { cause: { code: 'ECONNREFUSED' } } : {}),
        ...(category === 'brain_process_exit' ? { processExited: true } : {}),
        ...(category === 'invalid_response' ? { parseFailed: true } : {}),
        ...(category === 'request_timeout' ? { cause: { code: 'UND_ERR_HEADERS_TIMEOUT' } } : {}),
      });
    }
    this.log(`health probe failed: ${this.connection.statusLine()}`);
    throw new BrainOperationError(
      last!.record,
      last!.record.failureCategory,
      this.connection.statusLine(),
    );
  }

  /** The same `/health` payload, typed to include the operational readiness fields. */
  async healthDetail(signal?: AbortSignal): Promise<BrainHealthDetail> {
    return (await this.health(signal)) as BrainHealthDetail;
  }

  /** Consequential — never retried. */
  async route(payload: RouteRequest, signal?: AbortSignal): Promise<RouteResponse> {
    return unwrap(await this.routeGoverned(payload, signal));
  }

  /** Governed variant: returns the full outcome instead of throwing. */
  async routeGoverned(payload: RouteRequest, signal?: AbortSignal): Promise<BrainOperationOutcome<RouteResponse>> {
    return this.dispatch<RouteResponse>('route', '/route', payload, 'POST', {
      timeoutMs: this.timeoutMs,
      ...(signal ? { signal } : {}),
    });
  }

  /** Idempotent read — retried only when the policy explicitly allows it. */
  async retrieve(payload: RetrieveRequest, signal?: AbortSignal): Promise<RetrieveResponse> {
    return unwrap(await this.retrieveGoverned(payload, signal));
  }

  /** Governed variant: returns the full outcome instead of throwing. */
  async retrieveGoverned(payload: RetrieveRequest, signal?: AbortSignal): Promise<BrainOperationOutcome<RetrieveResponse>> {
    return this.dispatch<RetrieveResponse>('retrieve', '/retrieve', payload, 'POST', {
      timeoutMs: this.timeoutMs,
      ...(signal ? { signal } : {}),
    });
  }

  /** Consequential — never retried. */
  async chat(payload: ChatTurnRequest, signal?: AbortSignal): Promise<ChatTurnResponse> {
    return unwrap(await this.chatGoverned(payload, signal));
  }

  /** Governed variant: returns the full outcome instead of throwing. */
  async chatGoverned(payload: ChatTurnRequest, signal?: AbortSignal): Promise<BrainOperationOutcome<ChatTurnResponse>> {
    return this.dispatch<ChatTurnResponse>('chat', '/chat', payload, 'POST', {
      timeoutMs: this.timeoutMs,
      ...(signal ? { signal } : {}),
    });
  }

  /** Single governed dispatch path. Nothing in this class reaches the network any
   * other way. */
  private async dispatch<T>(
    action: string,
    path: string,
    body: unknown,
    method: 'GET' | 'POST',
    opts: { timeoutMs: number; signal?: AbortSignal },
  ): Promise<BrainOperationOutcome<T>> {
    const endpoint = `${this.baseUrl}${path}`;
    this.log(`${method} ${endpoint}`);
    return runBrainOperation<T>({
      operationId: nextOperationId(action),
      requestedAction: action,
      endpoint,
      method,
      timeoutMs: opts.timeoutMs,
      ...(body === undefined ? {} : { body }),
      ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
      ...(opts.signal ? { externalSignal: opts.signal } : {}),
    });
  }

  log(message: string): void {
    this.output.appendLine(`[${new Date().toISOString()}] ${message}`);
  }
}

/**
 * Governed replacement for the former parallel `callBrainTool` fetch path.
 *
 * Tool calls are CONSEQUENTIAL — they are never retried, and a
 * `terminal_state_unverified` outcome is never replayed, because the tool may already
 * have run on the server.
 */
export async function callBrainTool<TRequest, TResponse>(
  baseUrl: string,
  toolPath: string,
  body: TRequest,
  opts: { timeoutMs?: number; signal?: AbortSignal; fetchImpl?: FetchLike; method?: 'GET' | 'POST' } = {},
): Promise<BrainOperationOutcome<TResponse>> {
  const endpoint = `${baseUrl.replace(/\/$/, '')}${toolPath}`;
  return runBrainOperation<TResponse>({
    operationId: nextOperationId('tool'),
    requestedAction: `tool:${toolPath}`,
    endpoint,
    method: opts.method ?? 'POST',
    timeoutMs: opts.timeoutMs ?? 30_000,
    ...(body === undefined ? {} : { body }),
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    ...(opts.signal ? { externalSignal: opts.signal } : {}),
  });
}
