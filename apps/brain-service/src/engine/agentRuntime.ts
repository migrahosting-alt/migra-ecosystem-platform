/**
 * MigraAI Engine — agent runtime + orchestration service.
 *
 * The engine owns the public agent contract; a RUNTIME ADAPTER executes a run.
 * `LocalRuntimeAdapter` runs deterministic local agents entirely through the
 * shared tool boundary + engine approval store. `PilotRuntimeAdapter` is the seam
 * to the pilot-api runtime for workflows that need its tenant/policy/replay
 * guarantees; when that runtime is unavailable a run FAILS — it NEVER silently
 * falls back to a local mutating agent.
 *
 * Every tool call flows through {@link executeToolCore} (same validation +
 * approval + audit as `/api/ai/tools`). Mutating actions retain exact-action
 * approval binding and single-use execution. runId / stepId / actionId /
 * requestId / approvalId stay correlated on the record.
 */

import type { AgentDefinition, AgentContext, AgentRegistry } from './agentRegistry.js';
import {
  AgentRunStore,
  InvalidRunTransition,
  TERMINAL_STATES,
  type RunRecord,
  type RunState,
} from './agentRunStore.js';
import { executeToolCore, type ToolExecDeps } from './toolExecutor.js';
import type { PilotRuntimeClient, PilotRunOutcome } from './pilot/pilotRuntimeClient.js';

class AgentStepError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'AgentStepError';
  }
}
class AgentLimitError extends Error {
  constructor(public readonly detail: string) {
    super('LIMIT_EXCEEDED');
    this.name = 'AgentLimitError';
  }
}

export interface RuntimeAdapter {
  readonly kind: 'local' | 'pilot';
  start(rec: RunRecord, def: AgentDefinition): Promise<RunRecord>;
  resume(rec: RunRecord, def: AgentDefinition, decision: 'approve' | 'reject'): Promise<RunRecord>;
  cancel(rec: RunRecord): Promise<RunRecord>;
}

export class LocalRuntimeAdapter implements RuntimeAdapter {
  readonly kind = 'local';
  /** Server-side store of the exact proposed action per waiting run — never
   * exposed to clients; consumed once on approve. */
  private readonly pending = new Map<string, { tool: string; input: unknown; approvalId: string }>();

  constructor(
    private readonly store: AgentRunStore,
    private readonly toolDeps: ToolExecDeps,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async start(rec: RunRecord, def: AgentDefinition): Promise<RunRecord> {
    try {
      this.store.transition(rec, 'PLANNING');
      this.store.transition(rec, 'RUNNING');
      const ctx: AgentContext = {
        callTool: async <T = unknown>(tool: string, input: unknown): Promise<T> => {
          this.enforceLimits(rec, def);
          const stepId = this.store.newStepId();
          const outcome = await executeToolCore(this.toolDeps, { tool, input, requestId: rec.requestId });
          rec.steps.push({ stepId, kind: 'tool', label: tool, status: outcome.ok ? 'ok' : 'error' });
          if (!outcome.ok) throw new AgentStepError(outcome.code);
          return (outcome as { result?: T }).result as T;
        },
      };

      const outcome = await def.plan(rec.spec.input, ctx);

      if (outcome.kind === 'result') {
        this.store.transition(rec, 'COMPLETED');
        rec.result = outcome.result;
        return rec;
      }

      // Mutating: mint a single-use approval through the tool boundary (this both
      // validates the action and returns a preview) and park for approval.
      this.enforceLimits(rec, def);
      const mint = await executeToolCore(this.toolDeps, { tool: outcome.tool, input: outcome.input, requestId: rec.requestId });
      if (!mint.ok || mint.status !== 'approval_required' || !mint.approvalId) {
        throw new AgentStepError('PROPOSE_FAILED');
      }
      this.pending.set(rec.runId, { tool: outcome.tool, input: outcome.input, approvalId: mint.approvalId });
      rec.steps.push({ stepId: this.store.newStepId(), kind: 'propose', label: outcome.tool, status: 'ok' });
      rec.pendingAction = {
        actionId: this.store.newActionId(),
        tool: outcome.tool,
        approvalId: mint.approvalId,
        summary: outcome.summary,
      };
      this.store.transition(rec, 'WAITING_FOR_APPROVAL');
      return rec;
    } catch (err) {
      return this.fail(rec, err);
    }
  }

  async resume(rec: RunRecord, _def: AgentDefinition, decision: 'approve' | 'reject'): Promise<RunRecord> {
    if (rec.state !== 'WAITING_FOR_APPROVAL') {
      throw new InvalidRunTransition(rec.state, decision === 'approve' ? 'APPROVED' : 'CANCELLED', rec.runId);
    }
    if (decision === 'reject') {
      this.store.transition(rec, 'CANCELLED');
      this.pending.delete(rec.runId);
      return rec;
    }
    this.store.transition(rec, 'APPROVED');
    this.store.transition(rec, 'RESUMING');
    const pend = this.pending.get(rec.runId);
    this.pending.delete(rec.runId);
    if (!pend) {
      return this.fail(rec, new AgentStepError('APPROVAL_LOST'));
    }
    try {
      const exec = await executeToolCore(this.toolDeps, {
        tool: pend.tool,
        input: pend.input,
        approvalId: pend.approvalId,
        requestId: rec.requestId,
      });
      rec.steps.push({ stepId: this.store.newStepId(), kind: 'apply', label: pend.tool, status: exec.ok ? 'ok' : 'error' });
      if (exec.ok && exec.status === 'executed') {
        this.store.transition(rec, 'COMPLETED');
        rec.result = exec.result;
        return rec;
      }
      return this.fail(rec, new AgentStepError(exec.ok ? 'UNEXPECTED' : exec.code));
    } catch (err) {
      return this.fail(rec, err);
    }
  }

  async cancel(rec: RunRecord): Promise<RunRecord> {
    if (TERMINAL_STATES.has(rec.state)) {
      throw new InvalidRunTransition(rec.state, 'CANCEL_REQUESTED', rec.runId);
    }
    this.store.transition(rec, 'CANCEL_REQUESTED');
    rec.cancellation = 'requested';
    // Local runs have nothing executing asynchronously → confirm immediately.
    this.store.transition(rec, 'CANCELLED');
    rec.cancellation = 'confirmed';
    this.pending.delete(rec.runId);
    return rec;
  }

  private enforceLimits(rec: RunRecord, def: AgentDefinition): void {
    if (rec.steps.length >= def.descriptor.maxSteps) throw new AgentLimitError('step limit');
    if (this.now() - rec.createdAt > def.descriptor.maxRuntimeMs) throw new AgentLimitError('runtime limit');
  }

  private fail(rec: RunRecord, err: unknown): RunRecord {
    const code =
      err instanceof AgentLimitError ? 'LIMIT_EXCEEDED' : err instanceof AgentStepError ? err.code : 'RUNTIME_ERROR';
    if (!TERMINAL_STATES.has(rec.state)) {
      this.store.transition(rec, 'FAILED');
    }
    rec.error = { code, message: sanitizeErrorMessage(code) };
    this.pending.delete(rec.runId);
    return rec;
  }
}

/**
 * Delegates an agent run to the pilot-api runtime (tenant/policy/replay
 * guarantees) via an injected {@link PilotRuntimeClient}.
 *
 * FAIL-CLOSED is the invariant: with no client injected (delegation disabled) OR
 * when the runtime is unreachable OR when a delegated call throws, the run ends
 * FAILED / RUNTIME_UNAVAILABLE — it NEVER falls back to a local mutating agent
 * and NEVER calls the local tool boundary. Approval material (approvalId) and the
 * remote run id are held SERVER-SIDE in `pending`, correlated by engine runId, and
 * never surfaced to clients (they resume by runId + decision).
 */
export class PilotRuntimeAdapter implements RuntimeAdapter {
  readonly kind = 'pilot';
  /** engine runId → remote correlation. Run-oriented: pilot-api holds ALL approval
   * material, so no approvalId is tracked here. */
  private readonly pending = new Map<string, { pilotRunId: string; actionId: string }>();

  constructor(
    private readonly store: AgentRunStore,
    private readonly client?: PilotRuntimeClient,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async start(rec: RunRecord, _def: AgentDefinition): Promise<RunRecord> {
    if (!this.client) return this.fail(rec, 'RUNTIME_UNAVAILABLE', 'The remote agent runtime is not enabled.');
    let up = false;
    try {
      up = await this.client.probe();
    } catch {
      up = false;
    }
    if (!up) return this.fail(rec, 'RUNTIME_UNAVAILABLE', 'The remote agent runtime is unavailable.');

    this.store.transition(rec, 'PLANNING');
    this.store.transition(rec, 'RUNNING');
    let outcome: PilotRunOutcome;
    try {
      outcome = await this.client.startRun({
        agentId: rec.spec.agentId,
        agentVersion: rec.spec.agentVersion,
        input: rec.spec.input,
        requestId: rec.requestId,
        idempotencyKey: rec.requestId,
        // Delegated runs default to dry-run; live is a future explicit opt-in.
        mode: 'dry-run',
        limits: { maxSteps: rec.spec.limits.maxSteps, timeoutMs: rec.spec.limits.maxRuntimeMs },
      });
    } catch {
      return this.fail(rec, 'RUNTIME_UNAVAILABLE', 'The remote agent runtime failed to start the run.');
    }
    return this.applyOutcome(rec, outcome);
  }

  async resume(rec: RunRecord, _def: AgentDefinition, decision: 'approve' | 'reject'): Promise<RunRecord> {
    const held = this.pending.get(rec.runId);
    // Resume is only valid for a run parked with a known action; a replay after a
    // terminal state has no held action → illegal transition (→ 409).
    if (!held || rec.state !== 'WAITING_FOR_APPROVAL' || !this.client) {
      throw new InvalidRunTransition(rec.state, 'RESUMING', rec.runId);
    }

    if (decision === 'reject') {
      this.pending.delete(rec.runId); // single-use: consume before the terminal move
      try {
        await this.client.decide({ pilotRunId: held.pilotRunId, decision: 'reject', requestId: rec.requestId });
      } catch {
        /* best-effort notify; the run is abandoned regardless */
      }
      this.store.transition(rec, 'CANCELLED');
      rec.pendingAction = undefined;
      return rec;
    }

    this.store.transition(rec, 'APPROVED');
    this.store.transition(rec, 'RESUMING');
    this.pending.delete(rec.runId); // single-use: the held approval is now consumed
    rec.pendingAction = undefined;
    let outcome: PilotRunOutcome;
    try {
      outcome = await this.client.decide({ pilotRunId: held.pilotRunId, decision: 'approve', requestId: rec.requestId });
    } catch {
      return this.fail(rec, 'RUNTIME_UNAVAILABLE', 'The remote agent runtime failed to resume the run.');
    }
    return this.applyOutcome(rec, outcome);
  }

  async cancel(rec: RunRecord): Promise<RunRecord> {
    if (TERMINAL_STATES.has(rec.state)) throw new InvalidRunTransition(rec.state, 'CANCEL_REQUESTED', rec.runId);
    const held = this.pending.get(rec.runId);
    this.store.transition(rec, 'CANCEL_REQUESTED');
    rec.cancellation = 'requested';
    if (held && this.client) {
      try {
        await this.client.cancel({ pilotRunId: held.pilotRunId, requestId: rec.requestId });
      } catch {
        /* best-effort: the run is cancelled locally regardless */
      }
    }
    this.pending.delete(rec.runId);
    this.store.transition(rec, 'CANCELLED');
    rec.cancellation = 'confirmed';
    rec.pendingAction = undefined;
    return rec;
  }

  /** Map a remote outcome onto the engine's run-state machine. Called from RUNNING
   * (start) or RESUMING (approve). */
  private applyOutcome(rec: RunRecord, outcome: PilotRunOutcome): RunRecord {
    switch (outcome.status) {
      case 'completed':
        this.store.transition(rec, 'COMPLETED');
        rec.result = outcome.result;
        this.pending.delete(rec.runId);
        return rec;
      case 'waiting':
        // Park for approval; hold the approval material server-side. From RESUMING
        // we must pass through RUNNING to reach WAITING (legal-transition table).
        if (rec.state === 'RESUMING') this.store.transition(rec, 'RUNNING');
        this.pending.set(rec.runId, { pilotRunId: outcome.pilotRunId, actionId: outcome.action.actionId });
        this.store.transition(rec, 'WAITING_FOR_APPROVAL');
        // approvalId is held by pilot-api, not the engine; the summary carries a
        // non-sensitive marker (stripped from the client view regardless).
        rec.pendingAction = { actionId: outcome.action.actionId, tool: outcome.action.tool, approvalId: 'pilot-held', summary: outcome.action.summary };
        return rec;
      case 'failed':
        return this.fail(rec, outcome.code, outcome.message);
      case 'rejected':
      case 'cancelled':
        // Defensive: these are driven by resume(reject)/cancel, not by an outcome
        // of start/approve. If a remote reports one here, fail closed rather than
        // guess at a terminal transition.
        return this.fail(rec, 'RUNTIME_UNAVAILABLE', 'The remote agent runtime returned an unexpected terminal outcome.');
    }
  }

  private fail(rec: RunRecord, code: string, message: string): RunRecord {
    if (!TERMINAL_STATES.has(rec.state)) this.store.transition(rec, 'FAILED');
    rec.error = { code, message };
    this.pending.delete(rec.runId);
    rec.updatedAt = this.now();
    return rec;
  }
}

export type CreateResult =
  | { ok: true; run: RunRecord }
  | { ok: false; httpStatus: number; code: string; error: string; issues?: Array<{ path: string; message: string }> };

export type RunActionResult =
  | { ok: true; run: RunRecord }
  | { ok: false; httpStatus: number; code: string; error: string };

/** Client-facing run view: sanitized. Omits approval material and any raw action
 * input; exposes correlation ids, coarse state, sanitized step summaries, and the
 * result. */
export interface RunView {
  runId: string;
  requestId: string;
  agentId: string;
  agentVersion: string;
  runtime: 'local' | 'pilot';
  state: RunState;
  cancellation?: 'requested' | 'confirmed';
  steps: RunRecord['steps'];
  pendingAction?: { actionId: string; tool: string; summary: string };
  result?: unknown;
  error?: { code: string; message: string };
  createdAt: number;
  updatedAt: number;
  history: Array<{ at: number; state: RunState }>;
}

export function toRunView(rec: RunRecord): RunView {
  return {
    runId: rec.runId,
    requestId: rec.requestId,
    agentId: rec.spec.agentId,
    agentVersion: rec.spec.agentVersion,
    runtime: rec.runtime,
    state: rec.state,
    cancellation: rec.cancellation,
    steps: rec.steps,
    // Deliberately drop pendingAction.approvalId — approval material never leaves
    // the engine; clients resume by runId + decision, not by token.
    pendingAction: rec.pendingAction
      ? { actionId: rec.pendingAction.actionId, tool: rec.pendingAction.tool, summary: rec.pendingAction.summary }
      : undefined,
    result: rec.result,
    error: rec.error,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    history: rec.history,
  };
}

export class AgentService {
  private readonly local: LocalRuntimeAdapter;
  private readonly pilot: PilotRuntimeAdapter;

  constructor(
    private readonly registry: AgentRegistry,
    private readonly store: AgentRunStore,
    toolDeps: ToolExecDeps,
    opts: { now?: () => number; pilotClient?: PilotRuntimeClient } = {},
  ) {
    this.local = new LocalRuntimeAdapter(store, toolDeps, opts.now);
    // No client → the pilot adapter fails closed (delegation disabled).
    this.pilot = new PilotRuntimeAdapter(store, opts.pilotClient, opts.now);
  }

  private adapterFor(def: AgentDefinition): RuntimeAdapter {
    return def.runtime === 'pilot' ? this.pilot : this.local;
  }

  async createRun(params: { agentId: string; input: unknown; requestId: string; idempotencyKey?: string }): Promise<CreateResult> {
    const def = this.registry.definition(params.agentId);
    if (!def) {
      return { ok: false, httpStatus: 404, code: 'UNKNOWN_AGENT', error: `Unknown agent: ${params.agentId}` };
    }
    if (!def.descriptor.available) {
      return { ok: false, httpStatus: 403, code: 'CAPABILITY_DENIED', error: `Agent not available: ${params.agentId}` };
    }
    const parsed = def.inputSchema.safeParse(params.input);
    if (!parsed.success) {
      return {
        ok: false,
        httpStatus: 400,
        code: 'INVALID_INPUT',
        error: 'Agent input failed schema validation.',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      };
    }
    const spec = {
      agentId: def.descriptor.id,
      agentVersion: def.descriptor.version,
      input: parsed.data,
      limits: { maxSteps: def.descriptor.maxSteps, maxRuntimeMs: def.descriptor.maxRuntimeMs },
    };
    const rec = this.store.create({ spec, runtime: def.runtime, requestId: params.requestId, idempotencyKey: params.idempotencyKey });
    // Only drive a freshly-created run; an idempotent retry returns the existing
    // run untouched (reconcile, never replay).
    if (rec.state === 'CREATED') {
      await this.adapterFor(def).start(rec, def);
    }
    return { ok: true, run: rec };
  }

  getRun(runId: string): RunRecord | undefined {
    return this.store.get(runId);
  }

  async resumeRun(runId: string, decision: 'approve' | 'reject'): Promise<RunActionResult> {
    const rec = this.store.get(runId);
    if (!rec) return { ok: false, httpStatus: 404, code: 'UNKNOWN_RUN', error: `Unknown run: ${runId}` };
    const def = this.registry.definition(rec.spec.agentId);
    if (!def) return { ok: false, httpStatus: 404, code: 'UNKNOWN_AGENT', error: 'Agent no longer registered.' };
    try {
      await this.adapterFor(def).resume(rec, def, decision);
      return { ok: true, run: rec };
    } catch (err) {
      if (err instanceof InvalidRunTransition) {
        return { ok: false, httpStatus: 409, code: 'INVALID_STATE', error: 'The run cannot be resumed from its current state.' };
      }
      throw err;
    }
  }

  async cancelRun(runId: string): Promise<RunActionResult> {
    const rec = this.store.get(runId);
    if (!rec) return { ok: false, httpStatus: 404, code: 'UNKNOWN_RUN', error: `Unknown run: ${runId}` };
    const def = this.registry.definition(rec.spec.agentId);
    try {
      await this.adapterFor(def ?? ({ runtime: 'local' } as AgentDefinition)).cancel(rec);
      return { ok: true, run: rec };
    } catch (err) {
      if (err instanceof InvalidRunTransition) {
        return { ok: false, httpStatus: 409, code: 'INVALID_STATE', error: 'The run is already in a terminal state.' };
      }
      throw err;
    }
  }
}

function sanitizeErrorMessage(code: string): string {
  switch (code) {
    case 'LIMIT_EXCEEDED':
      return 'The agent exceeded its step or runtime limit.';
    case 'RUNTIME_UNAVAILABLE':
      return 'The agent runtime is unavailable.';
    case 'PROPOSE_FAILED':
      return 'The agent could not prepare its proposed action.';
    default:
      return 'The agent run failed.';
  }
}
