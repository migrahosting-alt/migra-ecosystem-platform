/**
 * MigraAI Engine — real Pilot Runtime client (pilot-api delegation).
 *
 * Backs {@link PilotRuntimeClient} with the shared `@migrapilot/pilot-client`
 * {@link AgentRunClient} over the DEDICATED `/api/pilot/v1/agent-runs` contract
 * (see docs/migraai-agent-run-contract.md) — NOT the registered-command `/execute`
 * surface. Constructed ONLY when delegation is explicitly enabled (env
 * `MIGRAPILOT_PILOT_RUNTIME_ENABLED` + a URL); otherwise the engine injects no
 * client and `runtime: 'pilot'` runs fail closed.
 *
 * FAIL-CLOSED BY CONSTRUCTION: `AgentRunClient` unwraps the stable `{ok,data}`
 * envelope and throws a typed PilotError on any error / malformed body; every
 * method here maps a throw to a `failed` outcome — never a false `completed`.
 * The run is addressed purely by `runId`; pilot-api holds all approval material.
 *
 * ⚠️ Live behavior still gated by the owner checklist in
 * docs/migraai-pilot-runtime.md (the pilot-api endpoint is fail-closed until its
 * agent registry + tool-runner are wired). Keep the flag OFF until it passes.
 */

import { PilotApiClient, AgentRunClient, type PilotApiConfig, type AgentRunView } from '@migrapilot/pilot-client';
import type { PilotRuntimeClient, PilotRunOutcome, PilotStartRequest, PilotDecideRequest } from './pilotRuntimeClient.js';

export class PilotApiRuntimeClient implements PilotRuntimeClient {
  private readonly client: PilotApiClient;
  private readonly agentRuns: AgentRunClient;

  constructor(cfg: PilotApiConfig) {
    this.client = new PilotApiClient(cfg);
    this.agentRuns = new AgentRunClient(this.client);
  }

  async probe(): Promise<boolean> {
    try {
      return await this.client.ready();
    } catch {
      return false;
    }
  }

  async startRun(req: PilotStartRequest): Promise<PilotRunOutcome> {
    try {
      const view = await this.agentRuns.create({
        requestId: req.requestId,
        idempotencyKey: req.idempotencyKey,
        agent: { id: req.agentId, version: req.agentVersion },
        scope: req.scope ?? {},
        mode: req.mode ?? 'dry-run',
        input: req.input,
        limits: req.limits ?? { maxSteps: 0, timeoutMs: 0 },
      });
      return this.mapView(view);
    } catch (err) {
      return this.failed(err);
    }
  }

  async decide(req: PilotDecideRequest): Promise<PilotRunOutcome> {
    try {
      const view =
        req.decision === 'approve'
          ? await this.agentRuns.approve(req.pilotRunId, req.requestId)
          : await this.agentRuns.reject(req.pilotRunId, req.requestId);
      return this.mapView(view);
    } catch (err) {
      return this.failed(err);
    }
  }

  async cancel(req: { pilotRunId: string; requestId: string }): Promise<PilotRunOutcome> {
    try {
      return this.mapView(await this.agentRuns.cancel(req.pilotRunId, req.requestId));
    } catch {
      // Best-effort: the adapter cancels the engine run locally regardless.
      return { status: 'cancelled', pilotRunId: req.pilotRunId };
    }
  }

  async reconcile(req: { pilotRunId: string }): Promise<PilotRunOutcome> {
    try {
      return this.mapView(await this.agentRuns.get(req.pilotRunId));
    } catch (err) {
      return this.failed(err);
    }
  }

  /** Map the sanitized agent-run view onto an engine outcome. Any non-terminal /
   * unknown status fails closed (reconcile never assumes completion). */
  private mapView(view: AgentRunView): PilotRunOutcome {
    switch (view.status) {
      case 'WAITING_APPROVAL':
        if (view.pendingAction) {
          return { status: 'waiting', pilotRunId: view.runId, action: { actionId: view.pendingAction.id, tool: 'pilot.action', summary: view.pendingAction.summary } };
        }
        return { status: 'failed', pilotRunId: view.runId, code: 'RUNTIME_UNAVAILABLE', message: 'Run is waiting but exposed no pending action.' };
      case 'COMPLETED':
        return { status: 'completed', pilotRunId: view.runId, result: view.result };
      case 'CANCELLED':
        return { status: 'cancelled', pilotRunId: view.runId };
      case 'FAILED':
      case 'TIMED_OUT':
        return { status: 'failed', pilotRunId: view.runId, code: view.error?.code ?? 'RUNTIME_FAILED', message: view.error?.message ?? `Remote run ${view.status}.` };
      default:
        // RUNNING / CANCEL_REQUESTED → not terminal.
        return { status: 'failed', pilotRunId: view.runId, code: 'RUNTIME_UNAVAILABLE', message: `Remote run is not terminal (${view.status}).` };
    }
  }

  private failed(err: unknown): PilotRunOutcome {
    const code = (err as { code?: string })?.code ?? 'RUNTIME_UNAVAILABLE';
    return { status: 'failed', code: String(code), message: 'The remote agent runtime call failed.' };
  }
}

/** Build the runtime client from brain env, or `undefined` when delegation is
 * disabled / unconfigured (→ the pilot adapter fails closed). */
export function buildPilotRuntimeClient(env: {
  pilotRuntimeEnabled?: boolean;
  pilotApiUrl?: string;
  pilotApiToken?: string;
  pilotApiAuthMode?: 'bearer' | 'none';
}, log: (m: string) => void = () => {}): PilotRuntimeClient | undefined {
  if (!env.pilotRuntimeEnabled || !env.pilotApiUrl) return undefined;
  const cfg: PilotApiConfig = {
    baseUrl: () => env.pilotApiUrl!,
    token: () => env.pilotApiToken,
    authMode: () => (env.pilotApiAuthMode === 'none' ? 'none' : 'bearer'),
    timeoutMs: () => 30_000,
    log,
  };
  return new PilotApiRuntimeClient(cfg);
}
