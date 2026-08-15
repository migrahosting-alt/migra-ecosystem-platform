// Operational Data Foundation — Slice 1, commit 2: wire the in-memory operational
// stores to durable persistence + hydrate them on startup.
//
// The stores already enforce metadata-only + redaction at their append boundary;
// these mappers only translate the (already-clean) records to/from durable rows.
// NEVER add prompts, completions, source, diffs, tokens, secrets, or raw paths.
//
// © MigraTeck LLC.

import type { OperationalPersistence, DurableAuditEvent, DurableUsageRecord, DurableIncident, DurableBudgetScope, DurableReservation } from './types.js';
import type { AuditStore, AuditRecord, AuditEventType } from '../auditLog.js';
import type { UsageLedger, UsageRecord } from '../providers/budget/usageLedger.js';
import type { IncidentManager, Incident, IncidentState } from '../incidents.js';
import type { BudgetManager, BudgetScope, Reservation } from '../providers/budget/budgetManager.js';

// ── record ↔ durable-row mappers ─────────────────────────────────────────────

/** Columns that have a dedicated durable field; everything else on a usage
 * record is preserved in fieldsJson (still metadata-only + already redacted). */
const USAGE_COLUMN_FIELDS = new Set(['usageId', 'executionCorrelationId', 'providerId', 'modelId', 'executionMode', 'policy', 'localOrCloud', 'timestamp', 'outcome', 'costUsd', 'costStatus', 'escalationReason']);

export function auditToDurable(r: AuditRecord): DurableAuditEvent {
  return {
    eventId: r.eventId, correlationId: r.correlationId, causationId: r.causationId, seq: r.seq,
    type: r.type, at: r.at, durationMs: r.durationMs, component: r.component, outcome: r.outcome,
    requestId: r.requestId, fieldsJson: JSON.stringify(r.fields ?? {}),
  };
}
export function durableToAudit(e: DurableAuditEvent): AuditRecord {
  return {
    eventId: e.eventId, correlationId: e.correlationId, causationId: e.causationId, seq: e.seq,
    type: e.type as AuditEventType, at: e.at,
    ...(e.durationMs !== undefined ? { durationMs: e.durationMs } : {}),
    component: e.component,
    ...(e.outcome !== undefined ? { outcome: e.outcome } : {}),
    ...(e.requestId !== undefined ? { requestId: e.requestId } : {}),
    fields: safeParse(e.fieldsJson),
  };
}

export function usageToDurable(r: UsageRecord): DurableUsageRecord {
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) if (!USAGE_COLUMN_FIELDS.has(k) && v !== undefined) extra[k] = v;
  return {
    usageId: r.usageId, correlationId: r.executionCorrelationId, providerId: r.providerId, modelId: r.modelId,
    executionMode: r.executionMode, policy: r.policy, localOrCloud: r.localOrCloud, at: r.timestamp,
    outcome: r.outcome, costUsd: r.costUsd, costStatus: r.costStatus, escalationReason: r.escalationReason,
    fieldsJson: JSON.stringify(extra),
  };
}
export function durableToUsage(d: DurableUsageRecord): UsageRecord {
  const extra = safeParse(d.fieldsJson);
  return {
    ...(extra as Partial<UsageRecord>),
    usageId: d.usageId, executionCorrelationId: d.correlationId, providerId: d.providerId, modelId: d.modelId,
    executionMode: d.executionMode as UsageRecord['executionMode'], policy: d.policy,
    localOrCloud: d.localOrCloud as UsageRecord['localOrCloud'], timestamp: d.at, outcome: d.outcome,
    ...(d.costUsd !== undefined ? { costUsd: d.costUsd } : {}),
    costStatus: d.costStatus as UsageRecord['costStatus'],
    ...(d.escalationReason !== undefined ? { escalationReason: d.escalationReason } : {}),
  };
}

export function incidentToDurable(i: Incident): DurableIncident {
  return {
    incidentId: i.incidentId, deduplicationKey: i.deduplicationKey, correlationId: i.correlationId,
    firstSeenAt: i.firstSeenAt, lastSeenAt: i.lastSeenAt, occurrenceCount: i.occurrenceCount,
    state: i.state, severity: i.severity, affectedJson: JSON.stringify(i.affected),
    lastDeliveryStatus: i.lastDeliveryStatus,
    resolutionJson: i.resolution ? JSON.stringify(i.resolution) : undefined,
  };
}
export function durableToIncident(d: DurableIncident): Incident {
  return {
    incidentId: d.incidentId, deduplicationKey: d.deduplicationKey, correlationId: d.correlationId,
    firstSeenAt: d.firstSeenAt, lastSeenAt: d.lastSeenAt, occurrenceCount: d.occurrenceCount,
    state: d.state as IncidentState, severity: 'critical', affected: safeParse(d.affectedJson) as Incident['affected'],
    lastDeliveryStatus: d.lastDeliveryStatus as Incident['lastDeliveryStatus'],
    ...(d.resolutionJson ? { resolution: safeParse(d.resolutionJson) as Incident['resolution'] } : {}),
  };
}

export function scopeToDurable(m: BudgetManager, s: BudgetScope, now: number): DurableBudgetScope {
  return {
    scopeId: m.scopeIdOf(s), kind: s.kind, scopeKeyName: s.key, hardLimitUsd: s.hardLimitUsd,
    spentUsd: s.spentUsd, reservedUsd: s.reservedUsd, periodStart: s.periodStart, updatedAt: now,
  };
}
export function reservationToDurable(r: Reservation): DurableReservation {
  return {
    reservationId: r.reservationId, amountUsd: r.amountUsd, scopeIdsJson: JSON.stringify(r.scopeIds),
    correlationId: r.correlationId, providerId: r.providerId, modelId: r.modelId,
    createdAt: r.createdAt, expiresAt: r.expiresAt, status: r.status,
  };
}
export function durableToReservation(d: DurableReservation): Reservation {
  return {
    reservationId: d.reservationId, amountUsd: d.amountUsd, scopeIds: safeParseArray(d.scopeIdsJson),
    correlationId: d.correlationId, providerId: d.providerId, modelId: d.modelId,
    createdAt: d.createdAt, expiresAt: d.expiresAt, status: d.status as Reservation['status'],
  };
}

function safeParse(json: string): Record<string, unknown> {
  try { const v = JSON.parse(json); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
function safeParseArray(json: string): string[] {
  try { const v = JSON.parse(json); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
}

// ── wiring ───────────────────────────────────────────────────────────────────

export interface OperationalStores {
  auditStore: AuditStore;
  usageLedger: UsageLedger;
  incidentManager: IncidentManager;
  budgetManager: BudgetManager;
}

/** Hydrate every operational store from durable history, THEN attach durable
 * writers — so the load never writes back to itself. Recovery history is captured
 * via the audit writer (recovery.* events are mirrored into the recovery table).
 *
 * @param recentLimit how many recent audit/usage rows to seed into memory for
 *   post-restart queryability (durability itself is the full durable table). */
/**
 * Handle returned by the wiring, so a caller that needs the detached queue to be
 * empty can say so explicitly.
 *
 * The three non-audit writers are detached BY CONTRACT (see below) — that is not
 * changed here. What is added is the ability to observe when the queue has
 * drained, which shutdown genuinely needs: closing the durable store while
 * writes are still queued discards operational evidence that was already
 * accepted in memory.
 */
export interface OperationalPersistenceHandle {
  /** Resolves once every write enqueued so far has settled. */
  drain(): Promise<void>;
}

export async function wireOperationalPersistence(
  durable: OperationalPersistence,
  stores: OperationalStores,
  opts: { now?: () => number; recentLimit?: number } = {},
): Promise<OperationalPersistenceHandle> {
  const now = opts.now ?? Date.now;
  const recentLimit = opts.recentLimit ?? 2000;

  // 1) Hydrate (durable → memory). recent* returns newest-first; the ring stores
  //    want newest-last, so reverse.
  stores.auditStore.hydrate((await durable.recentAuditEvents(recentLimit)).reverse().map(durableToAudit));
  stores.usageLedger.hydrate((await durable.recentUsageRecords(recentLimit)).reverse().map(durableToUsage));
  stores.incidentManager.hydrate((await durable.listIncidents(5000)).map(durableToIncident));
  stores.budgetManager.hydrate({
    scopes: (await durable.loadBudgetScopes()).map((s) => ({ scopeId: s.scopeId, spentUsd: s.spentUsd, reservedUsd: s.reservedUsd, periodStart: s.periodStart })),
    reservations: (await durable.loadReservations()).map(durableToReservation),
  });

  // 2) Attach writers (memory → durable). Every store swallows a durable failure
  //    internally, EXCEPT the audit store, which fails closed on CRITICAL events.
  //
  // That distinction is the whole reason this boundary needs care now that the
  // store is asynchronous.
  //
  // THE AUDIT WRITER IS AWAITED. AuditStore performs its durable write BEFORE
  // committing to memory and throws AuditCriticalWriteError when a CRITICAL
  // event cannot be persisted. Returning the promise is what lets it keep doing
  // that — a detached write would move the failure into an unhandled rejection
  // and silently turn fail-CLOSED into fail-OPEN.
  stores.auditStore.setWriter(async (r: AuditRecord) => {
    await durable.appendAuditEvent(auditToDurable(r));
    // Recovery history: mirror recovery.* lifecycle events into the dedicated
    // recovery table (metadata only — never the recovery stash's file content).
    if (r.type.startsWith('recovery.')) {
      const incidentId = typeof r.fields?.incidentId === 'string' ? (r.fields.incidentId as string) : undefined;
      await durable.appendRecoveryEvent({
        id: r.eventId, recoveryId: r.correlationId, correlationId: r.correlationId,
        ...(incidentId ? { incidentId } : {}), type: r.type, at: r.at,
        ...(r.outcome !== undefined ? { outcome: r.outcome } : {}), fieldsJson: JSON.stringify(r.fields ?? {}),
      });
    }
  });

  // The other three stores document that a durable failure must never weaken
  // in-memory accounting or enforcement, and each wraps its writer in a
  // try/catch to guarantee that. An async rejection escapes those catches, so
  // the detachment is made explicit HERE, where the decision actually lives,
  // rather than leaving three subsystems quietly leaking rejections.
  //
  // Writes are queued on a single chain rather than fired independently:
  // saveBudgetScope and upsertIncident are upserts keyed by id, so unordered
  // completion could persist a stale value over a fresh one. The chain preserves
  // submission order, which is what the synchronous contract used to give for
  // free.
  let tail: Promise<void> = Promise.resolve();
  const enqueueDetached = (op: () => Promise<unknown>): void => {
    tail = tail.then(op).then(
      () => undefined,
      () => undefined, // swallowed by contract; surfaced through health, not here
    );
  };

  stores.usageLedger.setWriter((r: UsageRecord) => enqueueDetached(() => durable.appendUsageRecord(usageToDurable(r))));
  stores.incidentManager.setPersist((i: Incident) => enqueueDetached(() => durable.upsertIncident(incidentToDurable(i))));
  stores.budgetManager.setPersist({
    onScope: (s: BudgetScope) => enqueueDetached(() => durable.saveBudgetScope(scopeToDurable(stores.budgetManager, s, now()))),
    onReservation: (r: Reservation) => enqueueDetached(() => durable.saveReservation(reservationToDurable(r))),
    onReservationRemoved: (id: string) => enqueueDetached(() => durable.removeReservation(id)),
  });

  // Persist the reconciled budget scopes once at startup so the durable snapshot
  // reflects any period roll that hydration applied (before the first live write).
  // Awaited, unlike the live writes: startup can afford to be correct, and a
  // caller awaiting wireOperationalPersistence should know hydration is settled.
  for (const s of stores.budgetManager.allScopes()) {
    await durable.saveBudgetScope(scopeToDurable(stores.budgetManager, s, now()));
  }

  // `tail` is reassigned on every enqueue, so this reads the CURRENT tail at call
  // time rather than closing over the one that existed at wiring time.
  return { drain: () => tail };
}
