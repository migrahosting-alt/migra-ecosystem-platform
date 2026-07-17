// Store telemetry + health (Operational Readiness Slice 2).
//
// Makes the proposal and approval lifecycle observable WITHOUT exposing proposal
// content, diffs, credentials, approval tokens, or raw workspace paths. Every
// event carries bounded metadata only; every store exposes a truthful health
// snapshot; eviction is never silent.

import { createHash } from 'node:crypto';

export type ProposalEvent =
  | 'proposal.created'
  | 'proposal.looked_up'
  | 'proposal.consumed'
  | 'proposal.expired'
  | 'proposal.evicted'
  | 'proposal.rejected'
  | 'proposal.unknown';

export type ApprovalEvent =
  | 'approval.minted'
  | 'approval.looked_up'
  | 'approval.consumed'
  | 'approval.expired'
  | 'approval.replayed'
  | 'approval.rejected'
  | 'approval.unknown';

export type LifecycleEvent = ProposalEvent | ApprovalEvent;

export interface TelemetryEvent {
  event: LifecycleEvent;
  at: number;
  correlationId?: string;
  /** BOUNDED METADATA ONLY — never content, diffs, paths, tokens, or secrets. */
  fields: Record<string, unknown>;
}

export type TelemetrySink = (e: TelemetryEvent) => void;

/** A no-op sink. Telemetry failures must never weaken enforcement, so callers
 * wrap real sinks so a throwing sink cannot break a lifecycle operation. */
export const NOOP_TELEMETRY: TelemetrySink = () => {};

/** Wrap a sink so it can never throw into the caller (invariant #8). */
export function safeSink(sink: TelemetrySink): TelemetrySink {
  return (e) => {
    try {
      sink(e);
    } catch {
      /* telemetry is best-effort; enforcement must not depend on it */
    }
  };
}

/** Short, non-reversible identifier for a hash/path — safe to log. */
export function shortId(value: string, len = 12): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, len);
}

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface StoreHealthSnapshot {
  name: string;
  status: HealthStatus;
  current_entries: number;
  capacity: number;
  utilization_percent: number;
  created_total: number;
  consumed_total: number;
  expired_total: number;
  evicted_total: number;
  rejected_total: number;
  oldest_entry_age_ms: number | null;
  next_expiration_ms: number | null;
  last_cleanup_at: number | null;
  cleanup_duration_ms: number | null;
}

/** Deterministic health tracker shared by both stores. Counters are cumulative;
 * status is derived from the CURRENT snapshot so it recovers when the underlying
 * condition clears. */
export class StoreHealth {
  private created = 0;
  private consumed = 0;
  private expired = 0;
  private evicted = 0;
  private rejected = 0;
  private lastCleanupAt: number | null = null;
  private cleanupDurationMs: number | null = null;
  private cleanupFailed = false;

  constructor(
    readonly name: string,
    private readonly capacity: number,
    private readonly now: () => number = () => Date.now(),
    /** Utilization at/above which status is `degraded`. */
    private readonly degradedUtilPct = 80,
  ) {}

  onCreated(): void {
    this.created += 1;
  }
  onConsumed(): void {
    this.consumed += 1;
  }
  onExpired(n = 1): void {
    this.expired += n;
  }
  onEvicted(n = 1): void {
    this.evicted += n;
  }
  onRejected(): void {
    this.rejected += 1;
  }
  /** Record a cleanup pass; `failed=true` drives status to `unhealthy` until a
   * later successful cleanup clears it. */
  onCleanup(durationMs: number, failed = false): void {
    this.lastCleanupAt = this.now();
    this.cleanupDurationMs = durationMs;
    this.cleanupFailed = failed;
  }

  snapshot(currentEntries: number, oldestEntryAgeMs: number | null, nextExpirationMs: number | null): StoreHealthSnapshot {
    const utilization = this.capacity > 0 ? Math.round((currentEntries / this.capacity) * 100) : 0;
    // Deterministic status — never "green because the process is alive".
    let status: HealthStatus = 'healthy';
    if (this.cleanupFailed || currentEntries > this.capacity) {
      status = 'unhealthy'; // cleanup failure OR capacity invariant violated
    } else if (utilization >= this.degradedUtilPct) {
      status = 'degraded'; // high utilization / capacity pressure
    }
    return {
      name: this.name,
      status,
      current_entries: currentEntries,
      capacity: this.capacity,
      utilization_percent: utilization,
      created_total: this.created,
      consumed_total: this.consumed,
      expired_total: this.expired,
      evicted_total: this.evicted,
      rejected_total: this.rejected,
      oldest_entry_age_ms: oldestEntryAgeMs,
      next_expiration_ms: nextExpirationMs,
      last_cleanup_at: this.lastCleanupAt,
      cleanup_duration_ms: this.cleanupDurationMs,
    };
  }
}
