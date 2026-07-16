/**
 * MigraAI Engine — Pilot Runtime client seam.
 *
 * The narrow contract the {@link PilotRuntimeAdapter} needs from pilot-api to run
 * an agent remotely. Kept as an interface so:
 *   - the real implementation ({@link PilotApiRuntimeClient}) backs it with the
 *     shared `@migrapilot/pilot-client` transport + approval lifecycle;
 *   - tests drive the adapter with a deterministic fake — no network, no GPU.
 *
 * The engine's run-state machine + token-hidden RunView are owned by the adapter;
 * this client only reports coarse OUTCOMES. Approval material (approvalId) travels
 * on the `waiting` outcome so the adapter can hold it SERVER-SIDE and resume by
 * decision — it is never surfaced to engine clients.
 */

export type PilotRunOutcome =
  // `waiting` carries only a display action id + summary — pilot-api holds ALL
  // approval material server-side, so no approvalId ever crosses this seam.
  | { status: 'completed'; pilotRunId: string; result?: unknown }
  | { status: 'waiting'; pilotRunId: string; action: { actionId: string; tool: string; summary: string } }
  | { status: 'rejected'; pilotRunId: string }
  | { status: 'cancelled'; pilotRunId: string }
  | { status: 'failed'; pilotRunId?: string; code: string; message: string };

export interface PilotStartRequest {
  agentId: string;
  agentVersion: string;
  input: unknown;
  requestId: string;
  /** Makes a retried start reconcile to the same remote run rather than double-run. */
  idempotencyKey?: string;
  scope?: { tenantId?: string; workspaceId?: string };
  /** Delegated runs default to dry-run; live requires an explicit opt-in upstream. */
  mode?: 'dry-run' | 'live';
  limits?: { maxSteps: number; timeoutMs: number };
}

export interface PilotDecideRequest {
  /** Run-oriented: the engine approves/rejects by run id; pilot-api resolves the
   * bound stored action + approval material internally. */
  pilotRunId: string;
  decision: 'approve' | 'reject';
  requestId: string;
}

export interface PilotRuntimeClient {
  /** Reachability probe — a false / throw means the runtime is unavailable and
   * the adapter FAILS closed (never a local fallback). */
  probe(): Promise<boolean>;
  /** Start a delegated run. */
  startRun(req: PilotStartRequest): Promise<PilotRunOutcome>;
  /** Approve or reject a parked action; pilot-api executes on approve (single-use). */
  decide(req: PilotDecideRequest): Promise<PilotRunOutcome>;
  /** Request cancellation of a remote run. */
  cancel(req: { pilotRunId: string; requestId: string }): Promise<PilotRunOutcome>;
  /** Reconcile the current remote state by run id (never re-executes). */
  reconcile(req: { pilotRunId: string }): Promise<PilotRunOutcome>;
}
