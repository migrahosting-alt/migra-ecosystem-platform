// Durable audit log (Operational Readiness Slice 3). An append-only, queryable
// record of every material coding-agent lifecycle transition, correlated end to
// end and causally linked, carrying REDACTED metadata only.
//
// Redaction contract (hard): a record NEVER holds proposal bodies, approval
// tokens, file contents, raw diffs, raw workspace paths, command output,
// environment values, or credentials. Callers pass only bounded metadata; the
// store additionally strips any field on the denylist before persisting.

import { createHash, randomUUID } from 'node:crypto';
import { StoreHealth, type StoreHealthSnapshot } from './storeTelemetry.js';
import { redactString } from './redaction.js';

export type AuditEventType =
  | 'bootstrap.created'
  | 'bootstrap.consumed'
  | 'activation.issued'
  | 'execution.started'
  | 'execution.routed'
  | 'execution.completed'
  | 'execution.failed'
  | 'execution.cancel_requested'
  | 'execution.reconciled'
  | 'approval.displayed'
  | 'proposal.stale'
  | 'execution.spawned'
  | 'cancellation.requested'
  | 'containment.terminated'
  | 'execution.timed_out'
  | 'execution.termination_failed'
  | 'shutdown.termination_requested'
  | 'shutdown.terminated'
  | 'loop.started'
  | 'loop.completed'
  | 'loop.failed'
  | 'tool.requested'
  | 'tool.completed'
  | 'tool.failed'
  | 'tool.denied'
  | 'proposal.created'
  | 'proposal.expired'
  | 'proposal.evicted'
  | 'proposal.consumed'
  | 'proposal.rejected'
  | 'approval.minted'
  | 'approval.approved'
  | 'approval.consumed'
  | 'approval.expired'
  | 'approval.replayed'
  | 'approval.rejected'
  | 'application.started'
  | 'application.completed'
  | 'application.failed'
  | 'application.rollback_started'
  | 'application.rollback_completed'
  | 'application.rollback_failed'
  | 'validation.started'
  | 'validation.completed'
  | 'validation.failed'
  | 'recovery.started'
  | 'recovery.plan_created'
  | 'recovery.approved'
  | 'recovery.applied'
  | 'recovery.validation_completed'
  | 'recovery.completed'
  | 'recovery.failed'
  | 'production.diagnostics.requested'
  | 'production.diagnostics.completed'
  | 'production.diagnostics.failed'
  | 'production.diagnostics.denied'
  | 'escalation.offered'
  | 'escalation.denied'
  | 'escalation.approved'
  | 'escalation.attempted'
  | 'escalation.completed'
  | 'escalation.failed'
  | 'budget.reservation_created'
  | 'budget.reservation_denied'
  | 'budget.reservation_consumed'
  | 'budget.reservation_released'
  | 'budget.reconciled'
  | 'budget.overrun_detected'
  | 'budget.warning_threshold_reached'
  | 'budget.hard_limit_reached'
  | 'budget.reservation_pressure'
  | 'budget.pricing_unknown'
  | 'budget.reconciliation_mismatch';

/** Event types whose loss is security/operationally critical — if these cannot
 * be persisted, the caller must fail closed before starting a new mutation. */
export const CRITICAL_EVENTS: ReadonlySet<AuditEventType> = new Set<AuditEventType>([
  'approval.consumed',
  'approval.approved',
  'execution.spawned',
  'application.started',
  'application.rollback_failed',
  'application.failed',
]);

export interface AuditRecord {
  eventId: string;
  correlationId: string;
  /** Prior event in this correlation chain (null = root). */
  causationId: string | null;
  /** Monotonic per-correlation order — deterministic within one execution. */
  seq: number;
  type: AuditEventType;
  at: number;
  durationMs?: number;
  component: string;
  outcome?: string;
  /** Resumed-request id when an application is resumed outside the original HTTP
   * request (preserves both original correlation + child request identity). */
  requestId?: string;
  /** BOUNDED, redacted metadata only. */
  fields: Record<string, unknown>;
}

/** Fields never allowed in an audit record (defense in depth over caller care). */
const FIELD_DENYLIST = new Set(['content', 'before', 'after', 'diff', 'patch', 'token', 'approvalId', 'rootPath', 'path', 'stdout', 'stderr', 'output', 'env', 'secret', 'password', 'replacement', 'command']);

/** Apply the canonical value-pattern redactor to any string that survives the
 * key denylist — so a secret hiding inside an outcome/reason string can never be
 * persisted even if its field name looked innocuous. */
function scrub(s: string): string {
  return redactString(s, { redactPaths: true }).value;
}

function redact(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (FIELD_DENYLIST.has(k)) continue;
    // Only primitives + small arrays of primitives survive — never nested bodies.
    if (v === null || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = scrub(v);
    else if (Array.isArray(v) && v.every((x) => typeof x === 'string' || typeof x === 'number')) out[k] = v.slice(0, 20).map((x) => (typeof x === 'string' ? scrub(x) : x));
    else if (typeof v === 'object') out[k] = '[object]'; // never serialize nested bodies
  }
  return out;
}

/** Safe, non-reversible identity for a hash/path. */
export function auditHash(value: string, len = 12): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, len);
}

export interface AuditAppendInput {
  correlationId: string;
  type: AuditEventType;
  component: string;
  outcome?: string;
  durationMs?: number;
  requestId?: string;
  /** Provide to override auto-causation (else the prior event for this correlation). */
  causationId?: string | null;
  /** Idempotency: a repeat append with the same eventId is a no-op. */
  eventId?: string;
  fields?: Record<string, unknown>;
}

/** Optional durable writer (e.g. append a JSONL line to disk). May throw; the
 * store treats a failure on a CRITICAL event as fail-closed. */
export type AuditWriter = (record: AuditRecord) => void;

const DEFAULT_MAX_RECORDS = 10_000;

/** Append-only, correlated, queryable audit store. In-memory ring with an
 * optional durable writer. Records are never mutated or deleted via the query
 * API; retention prunes only the oldest records beyond capacity. */
export class AuditStore {
  private readonly records: AuditRecord[] = [];
  private readonly seen = new Set<string>(); // eventId dedup
  private readonly lastByCorrelation = new Map<string, string>(); // correlationId → last eventId
  private readonly seqByCorrelation = new Map<string, number>();
  private readonly health = new StoreHealth('audit', DEFAULT_MAX_RECORDS, () => this.now());
  private writeFailures = 0;

  constructor(
    private readonly now: () => number = () => Date.now(),
    private writer: AuditWriter | null = null,
    private readonly maxRecords = DEFAULT_MAX_RECORDS,
    private readonly mkId: () => string = randomUUID,
  ) {}

  /** Attach a durable writer after construction (the global store is created at
   * import time, before the durable store exists). */
  setWriter(writer: AuditWriter | null): void {
    this.writer = writer;
  }

  /** Seed the in-memory ring + per-correlation seq/causation from durable history
   * on startup, so recent audit is queryable and seq continuity survives a
   * restart. Newest-last input. */
  hydrate(records: AuditRecord[]): void {
    for (const r of records) {
      if (this.seen.has(r.eventId)) continue;
      this.records.push(r);
      this.seen.add(r.eventId);
      if ((this.seqByCorrelation.get(r.correlationId) ?? 0) < r.seq) this.seqByCorrelation.set(r.correlationId, r.seq);
      this.lastByCorrelation.set(r.correlationId, r.eventId);
    }
    while (this.records.length > this.maxRecords) this.records.shift();
  }

  /** Append an event. Returns the record. Auto-assigns causation to the prior
   * event for this correlation and a monotonic per-correlation sequence.
   * Throws AuditCriticalWriteError if a CRITICAL event cannot be durably
   * written (caller must fail closed). */
  append(input: AuditAppendInput): AuditRecord {
    const eventId = input.eventId ?? this.mkId();
    if (this.seen.has(eventId)) {
      // Idempotent retry — return the existing record, no duplicate.
      return this.records.find((r) => r.eventId === eventId)!;
    }
    const seq = (this.seqByCorrelation.get(input.correlationId) ?? 0) + 1;
    const causationId =
      input.causationId !== undefined ? input.causationId : (this.lastByCorrelation.get(input.correlationId) ?? null);
    const record: AuditRecord = {
      eventId,
      correlationId: input.correlationId,
      causationId,
      seq,
      type: input.type,
      at: this.now(),
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
      component: input.component,
      ...(input.outcome !== undefined ? { outcome: input.outcome } : {}),
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
      fields: redact(input.fields ?? {}),
    };

    // Durable write BEFORE committing to memory for critical events, so a
    // critical record that cannot be persisted fails closed.
    if (this.writer) {
      try {
        this.writer(record);
      } catch (err) {
        this.writeFailures += 1;
        this.health.onCleanup(0, true); // durable sink unhealthy
        if (CRITICAL_EVENTS.has(input.type)) {
          throw new AuditCriticalWriteError(input.type, err instanceof Error ? err.message : String(err));
        }
        // Non-critical: continue with an in-memory fallback (health degraded).
      }
    }

    this.records.push(record);
    this.seen.add(eventId);
    this.seqByCorrelation.set(input.correlationId, seq);
    this.lastByCorrelation.set(input.correlationId, eventId);
    this.health.onCreated();
    if (this.records.length > this.maxRecords) {
      const dropped = this.records.shift();
      if (dropped) this.seen.delete(dropped.eventId);
      this.health.onEvicted();
    }
    return record;
  }

  // ── queries (read-only; bounded) ──────────────────────────────────────────────

  byCorrelation(correlationId: string, limit = 500): AuditRecord[] {
    return this.records.filter((r) => r.correlationId === correlationId).sort((a, b) => a.seq - b.seq).slice(0, limit);
  }
  byProposal(proposalPrefix: string, limit = 500): AuditRecord[] {
    return this.records.filter((r) => r.fields.proposal === proposalPrefix).slice(0, limit);
  }
  byOutcome(outcome: string, limit = 500): AuditRecord[] {
    return this.records.filter((r) => r.outcome === outcome).slice(0, limit);
  }
  byTimeRange(fromAt: number, toAt: number, limit = 500): AuditRecord[] {
    return this.records.filter((r) => r.at >= fromAt && r.at <= toAt).slice(0, limit);
  }

  healthSnapshot(): StoreHealthSnapshot & { write_failures: number } {
    return { ...this.health.snapshot(this.records.length, null, null), write_failures: this.writeFailures };
  }
}

export class AuditCriticalWriteError extends Error {
  constructor(readonly eventType: AuditEventType, detail: string) {
    super(`critical audit event ${eventType} could not be persisted: ${detail}`);
    this.name = 'AuditCriticalWriteError';
  }
}

/** Process-wide audit store — sources correlate by correlationId. */
export const auditStore = new AuditStore();
