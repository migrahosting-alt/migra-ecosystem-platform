// MigraPilot — typed client for the governed coding run API.
//
// The Brain is authoritative for every coding decision. This client transports
// requests and CLASSIFIES responses; it does not interpret workflow state, retry
// conflicts, or decide what a run "really" did.
//
// The classification is the point. `409 stale_revision`, `409 scope_hash_mismatch`,
// `422 unreadable`, "capability off", and "the network broke" require five
// different reactions from a UI — refresh and re-present, re-plan, surface
// corruption, hide the feature, offer retry. Flattening them into one error string
// would force the surface to guess, and a UI guessing about write authority is
// exactly what this workflow exists to prevent.
//
// vscode-free on purpose, so the whole contract is testable under plain
// `node --test` against a deterministic fetch double.

import { REQUEST_ID_HEADER, newRequestId } from '@migrapilot/pilot-client';

// ── Wire shapes (mirrors of the Brain's snapshot; never reconstructed) ────────

export interface CodingRunChildView {
  childId: string;
  kind: string;
  attempt: number;
  state: string;
  required: boolean;
  terminalCategory?: string;
}

export interface CodingScopeView {
  proposedPaths: string[];
  pathSetHash: string;
  approvalState: string;
  approvalExpiresAt: string;
  proposedAt: string;
  approvedAt?: string;
  evidence: Array<{ path: string; spans: Array<{ startLine: number; endLine: number; excerptHash: string }> }>;
  rationales: Array<{ path: string; rationale: string }>;
  excluded: Array<{ path: string; reason: string }>;
}

export interface CodingRunSnapshot {
  runId: string;
  revision: number;
  state: string;
  phase: string;
  issueSummary?: string;
  scope?: CodingScopeView;
  children: CodingRunChildView[];
  cancellation?: { requestedAt: string; confirmedAt?: string; status: 'cancelling' | 'cancelled' };
  latestValidation?: { commandRunId: string; command: string[]; exitCode: number | null; timedOut: boolean; passed: boolean; outputHead: string };
  blockers: string[];
  finalReport?: {
    stopReason: string;
    complete: boolean;
    changedFiles: string[];
    approvedPaths: string[];
    refusedPaths: string[];
    unusedScope: string[];
    unresolvedRisks: string[];
  };
  statusUrl: string;
}

export interface CodingRunAccepted {
  runId: string;
  revision: number;
  state: string;
  phase: string;
  statusUrl: string;
}

export interface GovernedCodingCapability {
  available: boolean;
  approvalMode: 'scope';
  progressMode: 'polling';
  workspaceRootsConfigured: number;
  unavailableReason?: string;
}

export type CodingConflictReason =
  | 'stale_revision'
  | 'scope_hash_mismatch'
  | 'approval_expired'
  | 'approval_invalidated'
  | 'approval_already_consumed'
  | 'invalid_state'
  | 'cancellation_requested';

export interface CodingConflict {
  reason: CodingConflictReason;
  currentRevision: number;
  currentState: string;
  currentPhase: string;
}

export interface CodingCorruption {
  runId: string;
  reason: 'payload_malformed' | 'payload_unsupported_version' | 'payload_absent';
  currentRevision: number;
  currentState: string;
  recoverable: boolean;
  detail: string;
}

// ── Result vocabulary ────────────────────────────────────────────────────────

/**
 * Every distinguishable outcome, as a discriminated union.
 *
 * `capability_unavailable` is separate from `not_found`: a 404 on a run means a
 * run is gone, while an unmounted route means the feature is off — and telling a
 * user their run vanished when the server never had the capability is a lie the
 * type system can prevent.
 */
export type CodingResult<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'accepted'; value: CodingRunAccepted }
  | { kind: 'conflict'; conflict: CodingConflict }
  | { kind: 'corrupt'; corruption: CodingCorruption }
  | { kind: 'not_found' }
  | { kind: 'capability_unavailable'; detail: string }
  | { kind: 'invalid_request'; message: string }
  | { kind: 'forbidden'; message: string }
  | { kind: 'timeout'; detail: string }
  | { kind: 'cancelled' }
  | { kind: 'transport_failure'; detail: string }
  | { kind: 'unexpected'; status: number; detail: string };

export interface CodingClientConfig {
  baseUrl(): string;
  timeoutMs(): number;
  log(message: string): void;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

export class CodingRunClient {
  constructor(
    private readonly config: CodingClientConfig,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
  ) {}

  /** Is the capability mounted, and if not, why? Never throws. */
  async getCodingCapability(signal?: AbortSignal): Promise<CodingResult<GovernedCodingCapability>> {
    const result = await this.request<{ governedCoding?: GovernedCodingCapability }>('GET', '/api/ai/coding/capability', undefined, signal);
    if (result.kind !== 'ok') return result as CodingResult<GovernedCodingCapability>;
    const capability = result.value.governedCoding;
    if (!capability) return { kind: 'capability_unavailable', detail: 'The Brain did not report a governed coding capability.' };
    return { kind: 'ok', value: capability };
  }

  /** Start a run. Answers `accepted` (202) — planning continues server-side. */
  async startCodingRun(input: { issueText: string; workspaceRoot: string; expectedRepository?: { headSha?: string; dirtyFingerprint?: string } }, signal?: AbortSignal): Promise<CodingResult<CodingRunAccepted>> {
    return this.request<CodingRunAccepted>('POST', '/api/ai/coding/runs', input, signal);
  }

  async getCodingRun(runId: string, signal?: AbortSignal): Promise<CodingResult<CodingRunSnapshot>> {
    return this.request<CodingRunSnapshot>('GET', `/api/ai/coding/runs/${encodeURIComponent(runId)}`, undefined, signal);
  }

  /**
   * Approve or reject a frozen scope.
   *
   * Both the revision AND the hash are required by the caller — this client will
   * not read them from a cached snapshot of its own, because the whole point is
   * that the operator decided against a specific proposal they were shown.
   */
  async submitScopeDecision(
    runId: string,
    input: { expectedRevision: number; pathSetHash: string; decision: 'approve' | 'reject' },
    signal?: AbortSignal,
  ): Promise<CodingResult<CodingRunSnapshot>> {
    return this.request<CodingRunSnapshot>('POST', `/api/ai/coding/runs/${encodeURIComponent(runId)}/scope-decision`, input, signal);
  }

  /** Request cancellation. The response says `cancelling` until Brain confirms. */
  async cancelCodingRun(runId: string, input: { expectedRevision: number }, signal?: AbortSignal): Promise<CodingResult<CodingRunSnapshot>> {
    return this.request<CodingRunSnapshot>('POST', `/api/ai/coding/runs/${encodeURIComponent(runId)}/cancel`, input, signal);
  }

  // ── transport ──────────────────────────────────────────────────────────────

  private async request<T>(method: 'GET' | 'POST', pathname: string, body: unknown, signal?: AbortSignal): Promise<CodingResult<T>> {
    const url = `${this.config.baseUrl().replace(/\/+$/, '')}${pathname}`;
    const requestId = newRequestId();
    const timeout = AbortSignal.timeout(this.config.timeoutMs());
    // Keeps the two reasons distinguishable below: a user cancellation and a
    // deadline are different facts, and a UI must not report one as the other.
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: { 'content-type': 'application/json', [REQUEST_ID_HEADER]: requestId },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: combined,
      });
    } catch (error) {
      if (signal?.aborted) return { kind: 'cancelled' };
      if (timeout.aborted) return { kind: 'timeout', detail: `No response within ${this.config.timeoutMs()}ms.` };
      const detail = error instanceof Error ? error.message : String(error);
      this.config.log(`coding-run: transport failure (${requestId}) — ${detail}`);
      return { kind: 'transport_failure', detail };
    }

    const payload = await response.json().catch(() => undefined) as unknown;

    switch (response.status) {
      case 200:
        return { kind: 'ok', value: payload as T };
      case 202:
        return { kind: 'accepted', value: payload as CodingRunAccepted };
      case 400:
        return { kind: 'invalid_request', message: messageOf(payload, 'The request was rejected as malformed.') };
      case 403:
        return { kind: 'forbidden', message: messageOf(payload, 'This workspace is not permitted.') };
      case 404:
        // A 404 on the capability probe means the route is not mounted; a 404 on a
        // run means that run is gone. Same status, different facts.
        return pathname === '/api/ai/coding/capability'
          ? { kind: 'capability_unavailable', detail: 'The governed coding API is not mounted on this Brain.' }
          : { kind: 'not_found' };
      case 409: {
        if (!isRecord(payload) || typeof payload.reason !== 'string') {
          return { kind: 'unexpected', status: 409, detail: 'A conflict was returned without a machine-readable reason.' };
        }
        return {
          kind: 'conflict',
          conflict: {
            reason: payload.reason as CodingConflictReason,
            currentRevision: Number(payload.currentRevision ?? -1),
            currentState: String(payload.currentState ?? 'unknown'),
            currentPhase: String(payload.currentPhase ?? 'unknown'),
          },
        };
      }
      case 422: {
        if (!isRecord(payload)) return { kind: 'unexpected', status: 422, detail: 'An unreadable-record response had no body.' };
        return {
          kind: 'corrupt',
          corruption: {
            runId: String(payload.runId ?? ''),
            reason: (payload.reason as CodingCorruption['reason']) ?? 'payload_malformed',
            currentRevision: Number(payload.currentRevision ?? -1),
            currentState: String(payload.currentState ?? 'unknown'),
            recoverable: payload.recoverable === true,
            detail: String(payload.detail ?? 'The durable record could not be interpreted.'),
          },
        };
      }
      default:
        return { kind: 'unexpected', status: response.status, detail: messageOf(payload, `Unexpected status ${response.status}.`) };
    }
  }
}

function messageOf(payload: unknown, fallback: string): string {
  if (isRecord(payload) && typeof payload.message === 'string' && payload.message.trim()) return payload.message;
  return fallback;
}

/** Terminal for POLLING purposes. Derived from the Brain's phase, never from
 * elapsed time — a slow model stage is not a finished run. */
export function isTerminalPhase(snapshot: CodingRunSnapshot): boolean {
  return snapshot.phase === 'terminal';
}

export function needsApproval(snapshot: CodingRunSnapshot): boolean {
  return snapshot.phase === 'awaiting_scope_approval'
    && snapshot.scope !== undefined
    && (snapshot.scope.approvalState === 'displayed' || snapshot.scope.approvalState === 'pending_display');
}

/**
 * The user-facing cancellation label.
 *
 * Deliberately a function of the DURABLE record, never of the VS Code
 * cancellation token: the token says someone pressed stop, which is a request,
 * not an outcome. Reporting "Cancelled" for work that may still be running is the
 * precise failure this whole workflow was built to prevent.
 */
export function cancellationLabel(snapshot: CodingRunSnapshot): string | undefined {
  if (!snapshot.cancellation) return undefined;
  if (snapshot.cancellation.confirmedAt && snapshot.state === 'CANCELLED') return 'Cancelled';
  if (snapshot.phase === 'terminal' && snapshot.state !== 'CANCELLED') return 'Cancellation could not be confirmed';
  return 'Cancellation requested';
}
