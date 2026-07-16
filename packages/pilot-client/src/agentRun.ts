// @migrapilot/pilot-client — Agent-Run runtime contract (v1).
//
// The typed client for the DEDICATED pilot-api agent delegation surface
// (`/api/pilot/v1/agent-runs`), separate from registered-command `/execute`.
// See docs/migraai-agent-run-contract.md. The engine submits an immutable spec
// and addresses everything by `runId`; pilot-api retains all approval material
// server-side, so NO approvalId / token / plan / raw args ever cross this wire.
//
// Envelopes are parsed EXPLICITLY: a success is `{ ok: true, data }`, an error is
// `{ ok: false, error }`. `unwrapEnvelope` validates the shape and throws a typed
// PilotError otherwise — the parser never guesses between bare and wrapped bodies.

import { PilotApiClient } from './pilotApiClient.js';
import { PilotError, type PilotErrorCode } from './pilotErrors.js';

/** Stable pilot-api success/error envelopes. */
export interface PilotEnvelope<T> {
  ok: true;
  data: T;
}
export interface PilotErrorEnvelope {
  ok: false;
  error: { code: string; message: string; requestId?: string };
}

export type AgentRunStatus = 'RUNNING' | 'WAITING_APPROVAL' | 'COMPLETED' | 'FAILED' | 'TIMED_OUT' | 'CANCEL_REQUESTED' | 'CANCELLED';
export type PendingActionStatus = 'PENDING' | 'APPROVED' | 'EXECUTED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED';

/** Sanitized pending-action view — id/status/summary only (never approvalId). */
export interface AgentRunPendingAction {
  id: string;
  status: PendingActionStatus;
  summary: string;
}

/** The run view returned in `data`. No approval material, plans, or raw args. */
export interface AgentRunView {
  runId: string;
  status: AgentRunStatus;
  pendingAction?: AgentRunPendingAction | null;
  result?: unknown;
  error?: { code: string; message: string } | null;
}

/** The immutable spec the engine submits. */
export interface AgentRunSpec {
  requestId: string;
  idempotencyKey?: string;
  agent: { id: string; version: string };
  scope: { tenantId?: string; workspaceId?: string };
  mode: 'dry-run' | 'live';
  input: unknown;
  limits: { maxSteps: number; timeoutMs: number };
}

/** Cancellation outcome status (run-oriented). */
export type CancelStatus = 'CANCEL_REQUESTED' | 'CANCELLED' | 'NOT_CANCELLABLE' | 'INVALID_STATE';

const BASE = '/api/pilot/v1/agent-runs';

/** Validate a stable envelope; throw a typed PilotError on an error envelope or a
 * malformed body. Success `data` is returned only after the shape checks pass. */
export function unwrapEnvelope<T>(body: unknown): T {
  const e = body as { ok?: unknown; data?: T; error?: { code?: string; message?: string; requestId?: string } };
  if (e && e.ok === true && 'data' in e) return e.data as T;
  if (e && e.ok === false && e.error) {
    throw new PilotError(mapEnvelopeCode(e.error.code), e.error.message || 'pilot-api returned an error.', { requestId: e.error.requestId });
  }
  throw new PilotError('SERVER_ERROR', 'pilot-api returned an unexpected response envelope.');
}

function mapEnvelopeCode(code: string | undefined): PilotErrorCode {
  switch (code) {
    case 'INVALID_STATE':
    case 'NOT_CANCELLABLE':
      return 'INVALID_STATE';
    case 'UNKNOWN_AGENT':
    case 'AGENT_VERSION_UNKNOWN':
    case 'CAPABILITY_DENIED':
      return 'CAPABILITY_MISSING';
    case 'POLICY_DENIED':
    case 'SCOPE_DENIED':
      return 'AUTH_INVALID';
    default:
      return 'SERVER_ERROR';
  }
}

/**
 * Typed client for the agent-run runtime contract. Every response is unwrapped
 * through {@link unwrapEnvelope} so callers get a validated {@link AgentRunView}
 * or a typed PilotError — never a raw or ambiguous body.
 */
export class AgentRunClient {
  constructor(private readonly pilot: PilotApiClient) {}

  async create(spec: AgentRunSpec, signal?: AbortSignal): Promise<AgentRunView> {
    const body = await this.pilot.request<unknown>('POST', BASE, { body: spec, requestId: spec.requestId, idempotencyKey: spec.idempotencyKey, signal });
    return unwrapEnvelope<AgentRunView>(body);
  }

  async get(runId: string, signal?: AbortSignal): Promise<AgentRunView> {
    return unwrapEnvelope<AgentRunView>(await this.pilot.request<unknown>('GET', `${BASE}/${encodeURIComponent(runId)}`, { signal }));
  }

  async approve(runId: string, requestId: string, signal?: AbortSignal): Promise<AgentRunView> {
    return unwrapEnvelope<AgentRunView>(await this.pilot.request<unknown>('POST', `${BASE}/${encodeURIComponent(runId)}/approve`, { body: { requestId }, requestId, idempotencyKey: requestId, signal }));
  }

  async reject(runId: string, requestId: string, reason?: string, signal?: AbortSignal): Promise<AgentRunView> {
    return unwrapEnvelope<AgentRunView>(await this.pilot.request<unknown>('POST', `${BASE}/${encodeURIComponent(runId)}/reject`, { body: { requestId, reason }, requestId, idempotencyKey: requestId, signal }));
  }

  async resume(runId: string, requestId: string, signal?: AbortSignal): Promise<AgentRunView> {
    return unwrapEnvelope<AgentRunView>(await this.pilot.request<unknown>('POST', `${BASE}/${encodeURIComponent(runId)}/resume`, { body: { requestId }, requestId, idempotencyKey: requestId, signal }));
  }

  async cancel(runId: string, requestId: string, signal?: AbortSignal): Promise<AgentRunView> {
    return unwrapEnvelope<AgentRunView>(await this.pilot.request<unknown>('POST', `${BASE}/${encodeURIComponent(runId)}/cancel`, { body: { requestId }, requestId, idempotencyKey: requestId, signal }));
  }
}
