// Approval lifecycle client + replay-safe reconciler (P4). vscode-free.
//
// The extension is a thin approver: it references server-issued identifiers
// (actionId, runId, approvalId) and asks pilot-api to transition state. It never
// reconstructs, edits, or re-plans an action. State enforcement is server-side
// (fail-closed, returns INVALID_STATE); requestId doubles as the idempotency key
// so approve/reject/resume and retries are single-use. Reconnect uses run state
// as the source of truth and NEVER replays the original mutation.

import { type ActionState, isTerminal } from './actionState.js';
import { type ActionChange } from './contracts.js';
import { newRequestId } from './correlation.js';
import { type ChatStreamEvent, type PilotApiClient } from './pilotApiClient.js';

const BASE = '/api/pilot/pending-actions';

export interface PendingAction {
  actionId: string;
  runId: string;
  state: ActionState;
  approvalId?: string;
  summary?: string;
  /** The proposed change, rendered for consent via approvalDelta. */
  change?: ActionChange;
}

export interface RunState {
  id: string;
  status: string;
  state?: ActionState;
}

export type ReconcileStatus = 'completed' | 'rejected' | 'terminal' | 'in_progress';

export interface ReconcileOutcome {
  status: ReconcileStatus;
  action: PendingAction;
}

export class ApprovalsClient {
  constructor(private readonly pilot: PilotApiClient) {}

  async list(signal?: AbortSignal): Promise<PendingAction[]> {
    const res = await this.pilot.request<{ items: PendingAction[] }>('GET', BASE, { signal });
    return res.items ?? [];
  }

  get(actionId: string, signal?: AbortSignal): Promise<PendingAction> {
    return this.pilot.request<PendingAction>('GET', `${BASE}/${encodeURIComponent(actionId)}`, { signal });
  }

  /** Approve — server permits only from PENDING; INVALID_STATE otherwise. The
   * requestId is the idempotency key, so a retry is single-use. */
  approve(actionId: string, requestId: string, signal?: AbortSignal): Promise<PendingAction> {
    return this.pilot.request<PendingAction>('POST', `${BASE}/${encodeURIComponent(actionId)}/approve`, {
      body: { requestId },
      idempotencyKey: requestId,
      requestId,
      signal,
    });
  }

  reject(actionId: string, requestId: string, reason?: string, signal?: AbortSignal): Promise<PendingAction> {
    return this.pilot.request<PendingAction>('POST', `${BASE}/${encodeURIComponent(actionId)}/reject`, {
      body: { requestId, reason },
      idempotencyKey: requestId,
      requestId,
      signal,
    });
  }

  /** Resume — server permits only for an APPROVED action with the EXACT
   * server-issued approvalId; triggers single-use execution. */
  resume(actionId: string, approvalId: string, requestId: string, signal?: AbortSignal): Promise<PendingAction> {
    return this.pilot.request<PendingAction>('POST', `${BASE}/${encodeURIComponent(actionId)}/resume`, {
      body: { requestId, approvalId },
      idempotencyKey: requestId,
      requestId,
      signal,
    });
  }

  runState(runId: string, signal?: AbortSignal): Promise<RunState> {
    return this.pilot.request<RunState>('GET', `/api/pilot/v1/runs/${encodeURIComponent(runId)}`, { signal });
  }

  /** Watch execution progress via SSE. Throws NETWORK on a dropped connection —
   * the caller must reconcile, not assume success/failure. */
  watchExecution(actionId: string, signal?: AbortSignal): AsyncGenerator<ChatStreamEvent> {
    return this.pilot.openSse('GET', `${BASE}/${encodeURIComponent(actionId)}/execute/stream`, { signal });
  }
}

/**
 * Reconnect/reconciliation: poll run state by runId (source of truth) until the
 * run is terminal or attempts run out. NEVER replays the mutation. A run still
 * running is reported as in_progress — a dropped SSE is never misread as
 * success or failure until reconciliation reaches a terminal state.
 */
export async function reconcileRun(
  approvals: ApprovalsClient,
  runId: string,
  actionId: string,
  opts: {
    maxAttempts?: number;
    delayMs?: number;
    sleep?: (ms: number) => Promise<void>;
    signal?: AbortSignal;
  } = {},
): Promise<ReconcileOutcome> {
  const maxAttempts = opts.maxAttempts ?? 15;
  const delayMs = opts.delayMs ?? 20;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (opts.signal?.aborted) {
      break;
    }
    const run = await approvals.runState(runId, opts.signal);
    const terminal =
      run.status === 'completed' ||
      run.status === 'rejected' ||
      run.status === 'terminal' ||
      (run.state ? isTerminal(run.state) : false);
    if (terminal) {
      const action = await approvals.get(actionId, opts.signal);
      const status: ReconcileStatus =
        run.status === 'completed' ? 'completed' : run.status === 'rejected' ? 'rejected' : 'terminal';
      return { status, action };
    }
    await sleep(delayMs);
  }
  const action = await approvals.get(actionId, opts.signal);
  return { status: 'in_progress', action };
}

/** Full approve→resume→reconcile, using a fresh requestId per op. Execution is
 * single-use (server-enforced); reconnect after any SSE loss reconciles via
 * run state without replaying the mutation. */
export async function approveResumeAndReconcile(
  approvals: ApprovalsClient,
  actionId: string,
  signal?: AbortSignal,
): Promise<ReconcileOutcome> {
  const approved = await approvals.approve(actionId, newRequestId(), signal);
  if (!approved.approvalId) {
    throw new Error('server did not issue an approvalId');
  }
  const resumed = await approvals.resume(actionId, approved.approvalId, newRequestId(), signal);
  return reconcileRun(approvals, resumed.runId, actionId, { signal });
}
