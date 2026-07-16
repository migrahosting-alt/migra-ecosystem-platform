/**
 * MigraAI Engine — agent run store + state machine.
 *
 * Owns the lifecycle of an agent run. The run is bound to ONE immutable
 * specification (agent + version + input + limits) captured at creation; nothing
 * — including replanning — may mutate it. Transitions are defined centrally and
 * fail closed: an illegal transition throws rather than silently corrupting
 * state. Terminal states are immutable.
 *
 * Sanitized by construction: a run record holds the immutable spec, coarse state,
 * a transition history, sanitized step summaries, an optional pending-action
 * summary, and a sanitized result — never raw prompts, chain-of-thought, provider
 * secrets, approval material, or unsanitized tool inputs.
 */

export type RunState =
  | 'CREATED'
  | 'PLANNING'
  | 'RUNNING'
  | 'WAITING_FOR_APPROVAL'
  | 'APPROVED'
  | 'RESUMING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCEL_REQUESTED'
  | 'CANCELLED'
  | 'EXPIRED';

export const TERMINAL_STATES: ReadonlySet<RunState> = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED']);

/** Central legal-transition table. Anything not listed is illegal (fail closed). */
const LEGAL: Record<RunState, ReadonlySet<RunState>> = {
  CREATED: new Set(['PLANNING', 'CANCEL_REQUESTED', 'FAILED']),
  PLANNING: new Set(['RUNNING', 'FAILED', 'CANCEL_REQUESTED']),
  RUNNING: new Set(['WAITING_FOR_APPROVAL', 'COMPLETED', 'FAILED', 'CANCEL_REQUESTED']),
  WAITING_FOR_APPROVAL: new Set(['APPROVED', 'CANCEL_REQUESTED', 'CANCELLED', 'EXPIRED', 'FAILED']),
  APPROVED: new Set(['RESUMING', 'FAILED', 'CANCEL_REQUESTED']),
  RESUMING: new Set(['RUNNING', 'COMPLETED', 'FAILED', 'CANCEL_REQUESTED']),
  CANCEL_REQUESTED: new Set(['CANCELLED', 'FAILED']),
  COMPLETED: new Set(),
  FAILED: new Set(),
  CANCELLED: new Set(),
  EXPIRED: new Set(),
};

export function canTransition(from: RunState, to: RunState): boolean {
  return LEGAL[from]?.has(to) ?? false;
}

/** Immutable run specification — frozen at creation. */
export interface RunSpec {
  agentId: string;
  agentVersion: string;
  input: unknown;
  limits: { maxSteps: number; maxRuntimeMs: number };
}

export interface StepSummary {
  stepId: string;
  kind: 'tool' | 'model' | 'propose' | 'apply';
  label: string;
  status: 'ok' | 'error';
}

export interface PendingActionSummary {
  actionId: string;
  tool: string;
  approvalId: string;
  summary: string;
}

export interface RunRecord {
  runId: string;
  requestId: string;
  spec: RunSpec;
  runtime: 'local' | 'pilot';
  state: RunState;
  history: Array<{ at: number; state: RunState }>;
  steps: StepSummary[];
  pendingAction?: PendingActionSummary;
  result?: unknown;
  error?: { code: string; message: string };
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  /** Cancellation intent, tracked separately from the terminal state so a client
   * can distinguish "requested" from "confirmed". */
  cancellation?: 'requested' | 'confirmed';
}

export class InvalidRunTransition extends Error {
  constructor(public readonly from: RunState, public readonly to: RunState, public readonly runId: string) {
    super(`Illegal run transition ${from} → ${to}`);
    this.name = 'InvalidRunTransition';
  }
}

const DEFAULT_TTL = 15 * 60_000;
const MAX_RUNS = 500;

export class AgentRunStore {
  private readonly byId = new Map<string, RunRecord>();
  private readonly byIdempotency = new Map<string, string>();

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly mkId: (prefix: string) => string = defaultId,
    private readonly ttlMs = DEFAULT_TTL,
  ) {}

  create(params: { spec: RunSpec; runtime: 'local' | 'pilot'; requestId: string; idempotencyKey?: string }): RunRecord {
    // Idempotency: a retried create with the same key reconciles to the same run.
    if (params.idempotencyKey) {
      const existingId = this.byIdempotency.get(params.idempotencyKey);
      const existing = existingId ? this.byId.get(existingId) : undefined;
      if (existing) return existing;
    }
    const t = this.now();
    const record: RunRecord = {
      runId: this.mkId('run'),
      requestId: params.requestId,
      spec: Object.freeze({ ...params.spec, limits: Object.freeze({ ...params.spec.limits }) }) as RunSpec,
      runtime: params.runtime,
      state: 'CREATED',
      history: [{ at: t, state: 'CREATED' }],
      steps: [],
      createdAt: t,
      updatedAt: t,
      expiresAt: t + this.ttlMs,
    };
    this.byId.set(record.runId, record);
    if (params.idempotencyKey) this.byIdempotency.set(params.idempotencyKey, record.runId);
    if (this.byId.size > MAX_RUNS) {
      const oldest = this.byId.keys().next().value;
      if (oldest) this.byId.delete(oldest);
    }
    return record;
  }

  get(runId: string): RunRecord | undefined {
    const rec = this.byId.get(runId);
    if (rec && !TERMINAL_STATES.has(rec.state) && rec.expiresAt <= this.now()) {
      // Lapsed runs expire (terminal); expiry is itself a legal transition guard.
      this.transition(rec, 'EXPIRED');
    }
    return rec;
  }

  /** Apply a state transition, enforcing the central table. Throws on an illegal
   * transition (fail closed) — callers must not swallow this. */
  transition(rec: RunRecord, to: RunState): RunRecord {
    if (rec.state === to) return rec;
    if (!canTransition(rec.state, to)) {
      throw new InvalidRunTransition(rec.state, to, rec.runId);
    }
    rec.state = to;
    rec.updatedAt = this.now();
    rec.history.push({ at: rec.updatedAt, state: to });
    return rec;
  }

  newStepId(): string {
    return this.mkId('step');
  }
  newActionId(): string {
    return this.mkId('act');
  }
}

function defaultId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`.slice(0, 24);
}
