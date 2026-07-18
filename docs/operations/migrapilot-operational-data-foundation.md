# MigraPilot — Operational Data Foundation (Slice 1: Durable Operational Store)

**Mission:** make MigraPilot's operational evidence durable across restarts so future
decisions rest on real historical data, not runtime memory. This is a **persistence**
concern — *not* analytics. No dashboards, no trend math here; just: the evidence
survives a restart, bounded and verifiable.

## What persists (metadata only)

Schema v2 (`MIGRAPILOT_STATE_DB`) adds six operational tables. Every row is
**bounded, already-redacted metadata**:

| Table | Source (in-memory store) | Key semantics |
|-------|--------------------------|---------------|
| `op_audit_events` | `AuditStore` | append-only, idempotent by `event_id`; per-correlation `seq`+causation |
| `op_usage_records` | `UsageLedger` | append-only, idempotent by `usage_id` |
| `op_incidents` | `IncidentManager` | mutable-by-`incident_id` (upsert); dedup key preserved |
| `op_recovery_events` | recovery.* audit events | append-only recovery history |
| `op_budget_scopes` | `BudgetManager` | running totals (spent/reserved/periodStart) per scope |
| `op_reservations` | `BudgetManager` | active reservations; removed on consume/release/expire |

## What is NEVER persisted

Prompts, completions, source code, diffs, approval tokens, proposal bodies, secrets,
credentials, command output, raw workspace paths. Redaction is enforced at each
store's `append()` boundary (field denylists + value-pattern scrub + length caps),
so the durable writers inherit a metadata-only guarantee. The recovery **stash**
(raw reverse-material / file content used to roll back a partial write) is held only
in memory and is **never** written to the durable store — only recovery *lifecycle
metadata* is persisted.

## Startup recovery (no "everything reset")

On boot, when a durable store is present, the engine:

1. **loads** durable operational history into the in-memory stores
   (`wireOperationalPersistence`): recent audit + usage (for post-restart
   queryability), all incidents (for dedup continuity), budget running totals +
   active reservations;
2. **reconciles budget** — persisted spent/reserved/periodStart are applied *only*
   to scopes the current env config still defines (a removed scope's total is
   dropped, never leaked onto another scope); elapsed periods roll forward;
3. **verifies integrity** (`PRAGMA integrity_check`) — a failure is reported via
   health and logged, **never a crash**: the engine continues with whatever durable
   state survived;
4. **attaches durable writers** (after hydration, so the load never writes back) and
   starts the retention worker.

An **open incident** survives a restart and still deduplicates a repeat occurrence to
the same incident (no re-notification storm).

## Retention (configurable; open incidents never pruned)

Age-based, run by a background worker (one pass on start, then on cadence). Defaults
match the Slice 1 policy:

| Store | Default window | Env override |
|-------|----------------|--------------|
| Usage ledger | 90 days | `MIGRAPILOT_OPERATIONAL_RETENTION_USAGE_DAYS` |
| Audit events | 180 days | `MIGRAPILOT_OPERATIONAL_RETENTION_AUDIT_DAYS` |
| Incidents (resolved only) | 365 days | `MIGRAPILOT_OPERATIONAL_RETENTION_INCIDENT_DAYS` |
| Recovery history | 365 days | `MIGRAPILOT_OPERATIONAL_RETENTION_RECOVERY_DAYS` |
| Worker cadence | 360 min (6h) | `MIGRAPILOT_OPERATIONAL_RETENTION_INTERVAL_MINUTES` |
| Write-latency degraded threshold | 250 ms | `MIGRAPILOT_OPERATIONAL_WRITE_LATENCY_DEGRADED_MS` |

**Open incidents are NEVER pruned** — only `resolved` incidents past their window are
removed. A non-positive / unparseable override keeps the default (retention is never
silently disabled by a typo).

## Health (`GET /health` → `operational`)

Truthful, never green-because-alive:

```
status               healthy | degraded | unhealthy
reachable            durable store opened + answered a probe write
schemaCurrent        engine schema == durable schema (applied, ready)
schemaVersion        2
integrity            ok | <first problem> | unknown
retentionWorker      running | stopped
lastRetentionAt      <ts | null>
lastRetentionDeleted { audit, usage, incidents, recovery } | null
writeLatencyMs       <monotonic probe> ; writeLatencyOk boolean
storageBytes         durable file size | null
counts               per-table row counts
```

`unhealthy` on unreachable / integrity problem / schema mismatch; `degraded` while
integrity is unverified or write latency is above threshold; else `healthy`.

## Shutdown

`SIGTERM` / `SIGINT` call `app.close()`, whose `onClose` hook stops the retention
worker and closes the durable store cleanly (WAL flushed; never left mid-write).

## Verified

- `durableOperational.test.ts` — schema v2, restart survival, idempotent append,
  incident upsert, budget scope+reservation reload, retention (open incidents
  retained), v1→v2 additive upgrade, integrity ok.
- `operationalBridge.test.ts` — restart survival *through the live managers* for
  audit/usage, open-incident dedup continuity, budget totals+reservation
  reconciliation across three boots, config-change safety.
- `operationalMaintenance.test.ts` — window pruning + open-incident retention,
  integrity+health, degraded-until-verified, worker start/stop.
- `scripts/validate-operational-restart.mjs` — end-to-end: start the brain on a
  temp state DB, drive real audit/usage/incident/budget evidence, restart, confirm
  the evidence survived.
