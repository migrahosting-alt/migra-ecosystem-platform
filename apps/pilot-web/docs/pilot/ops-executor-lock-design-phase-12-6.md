# MigraPilot Executor Lock — Design (Phase 12.6)

> **Status: DESIGN ONLY — NOT IMPLEMENTED.** This document specifies the execution-lock model that a
> *future* dev-only executor (see [`ops-executor-design-phase-12-5.md`](./ops-executor-design-phase-12-5.md))
> would require. **No lock runtime, table, tool, or executor is created in this phase.** Nothing here
> changes behavior: `ops-eligibility-policy.ts` still returns `eligibleForExecution:false` for every
> input, all real verbs in `ops-action-registry.ts` are `enabled:false` and **blocked** by `policy.ts`,
> and `ops-target-allowlist.ts` returns `eligible:false` for everything.
>
> **Hard rule (Phase 12.6):** there is **no executable path for real actions** after this phase.

## 1. Purpose

The execution lock is the concurrency-and-replay guard from Phase 12.5 §2 step 9 / §7 promotion gate 7. It exists to:

- **Prevent concurrent execution** on the same target/action/resource.
- **Prevent duplicate execution** from repeated/retried requests (idempotency).
- **Prevent approval replay** (one approval ⇒ at most one execution).
- **Prevent target drift after approval** (the bound `target/action/payloadHash` cannot change mid-flight).
- **Make execution auditable** (every lock transition is journaled).
- **Fail closed if lock state is unknown** (no execution without a confirmed, owned, fresh lock).

The lock never *grants* execution rights — eligibility (12.4) + preflight (12.3) + approval still gate
that. The lock only guarantees *at most one* bound execution proceeds, and that it is observable.

## 2. Lock scopes (most-specific wins; an executor picks one per action)

| Scope | Key | Use |
|---|---|---|
| `global` | `*` | emergency freeze of all execution (admin) |
| `target` | `targetId` | one action at a time per target |
| `target+service` | `targetId:serviceName` | per-service serialization |
| `target+action` | `targetId:actionName` | **default** for most dev actions |
| `target+action+resource` | `targetId:actionName:resourceId` | fine-grained (per-row/per-object) |
| `approval-specific` | `approvalId` | strict one-execution-per-approval |
| `idempotency-key` | `idempotencyKey` | dedupe identical retried requests |

The narrowest scope that still prevents the hazard is preferred; `target+action` is the baseline.

## 3. Required lock fields

`lockId` · `targetId` · `actionName` · `serviceName?` · `resourceId?` · `approvalId` ·
`approvalPayloadHash` · `idempotencyKey` · `owner` (executor instance id) · `status` · `acquiredAt` ·
`expiresAt` · `heartbeatAt` · `releasedAt` · `releaseReason` · `journalActionId` · `createdBy` ·
`environment` (must be `dev`) · `metadata` (redacted — never secrets/raw payload).

## 4. Statuses

`pending` → `acquired` → (`heartbeat_missed`) → `released` | `expired` | `failed` | `force_released`.

- `pending`: requested, atomicity (lock+journal-start) not yet confirmed.
- `acquired`: owned and live.
- `heartbeat_missed`: heartbeat overdue → candidate stale; requires operator review (never auto-reclaimed for a real action).
- `released`: clean terminal after postchecks + report.
- `expired`: TTL passed without clean release — **does not** imply the action was safe (§5).
- `failed`: execution/lock error terminal.
- `force_released`: operator-forced terminal (§6).

## 5. Acquisition rules (fail-closed, in order — all before any lock row is written)

1. **Dev targets only.** 2. **Production target → reject before lock.** 3. **Unknown target → reject before lock.**
4. **Disabled target → reject before lock.** 5. **Disabled action → reject before lock.**
6. Approval **exists** and matches **exact** `target/action/payloadHash`. 7. Approval is **fresh**.
8. Approval is **unconsumed**. 9. **Postgres ops journal required** for real execution.
10. **Postgres approval store required** for real execution.
11. **Lock acquisition + journal-start must be atomic** (single transaction) in any future implementation.
12. **If atomicity cannot be guaranteed, execution must not start** (fail closed).

### TTL / heartbeat
- **Short default TTL** for dev actions; an **action-specific `maxTtl`** from the registry caps it.
- **Heartbeat interval** < TTL; the owner refreshes `heartbeatAt`.
- **Stale detection:** `now > heartbeatAt + grace` ⇒ `heartbeat_missed` ⇒ **operator review** (no auto-reclaim).
- **No automatic retry** of real actions, ever.
- An **expired lock does not imply the action was safe** — it means "unknown outcome," requiring review.

## 6. Release rules
- **Clean release** only after postchecks + report → `released` (`releaseReason:"completed"`).
- **Failed release** after execution failure → `failed` (recovery guidance generated, no auto-fix).
- **Force release requires explicit operator confirmation**; it **must not trigger retry**.
- Every release **appends a journal event**; release **never deletes lock history** (append-only audit).

## 7. Future Postgres table sketch (documentation only — NO migration added)

```sql
-- PROPOSED, not created in this phase.
CREATE TABLE IF NOT EXISTS pilot_ops_execution_locks (
  id                    uuid PRIMARY KEY,
  target_id             text NOT NULL,
  action_name           text NOT NULL,
  service_name          text,
  resource_id           text,
  approval_id           text NOT NULL,
  approval_payload_hash text NOT NULL,
  idempotency_key       text NOT NULL,
  owner                 text NOT NULL,
  status                text NOT NULL,            -- pending|acquired|heartbeat_missed|released|expired|failed|force_released
  acquired_at           timestamptz,
  expires_at            timestamptz,
  heartbeat_at          timestamptz,
  released_at           timestamptz,
  release_reason        text,
  journal_action_id     text,                     -- FK to pilot_ops_action_journal
  created_by            text,
  environment           text NOT NULL DEFAULT 'dev',
  metadata_json         jsonb NOT NULL DEFAULT '{}'::jsonb,  -- redacted
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
```

**Index / uniqueness ideas:**
- **Active-lock uniqueness** by target/action/resource: `UNIQUE (target_id, action_name, coalesce(resource_id,'')) WHERE status IN ('pending','acquired','heartbeat_missed')` (partial unique → at most one live lock per scope).
- **Approval single-use:** `UNIQUE (approval_id)` (one lock per approval ⇒ no replay).
- **Idempotency-key uniqueness:** `UNIQUE (idempotency_key)`.
- **Stale sweep:** index `(status, expires_at)`.
- **Per-target view:** index `(target_id, status)`.
- Non-destructive forever: never `DROP`/`DELETE` history (matches migrations §0001–0003 discipline).

## 8. Future journal events

`executor.lock.requested` · `executor.lock.acquired` · `executor.lock.rejected` ·
`executor.lock.heartbeat` · `executor.lock.heartbeat_missed` · `executor.lock.released` ·
`executor.lock.expired` · `executor.lock.force_release_requested` · `executor.lock.force_released` ·
`executor.lock.failed` (via `ops-action-journal.ts`, metadata sanitized).

## 9. Failure behavior (fail closed)

Fail closed (reject, no execution) on **any** of: unknown lock state · journal write failure ·
approval store unavailable · lock backend unavailable · `target/action/payloadHash` changed.
And invariants: **no action starts without an acquired lock** · **no action starts without a journal
start event** · **no automatic retry after an ambiguous failure** (operator decides).

## 10. UI / admin visibility requirements

- Show **active locks** + **stale locks** (`heartbeat_missed`/near-expiry).
- Show **owner**, **target/action/resource**, **startedAt / TTL / heartbeat**.
- **Force-release button only behind explicit operator approval** (and a confirmation step).
- **Never show secrets**; metadata redacted.
- Show a **"dev-only"** badge; **production lock attempts rendered as blocked** (never acquirable).

## 11. Promotion gates — all required before locks are implemented

Bonex approval · lock-storage decision · Postgres migration reviewed · transaction strategy reviewed ·
journal-coupling reviewed · approval-consumption semantics reviewed · stale-lock playbook reviewed ·
force-release UX reviewed · redaction tested · CI green · **no production target configured**.

## 12. What this phase does NOT do
- No lock module, table, migration, route, tool, or executor.
- No registry/policy/classification change; `eligibleForExecution` stays hard-`false`.
- No memory/approval/journal/pgvector default change.
- Adds **only this document** (+ a one-line cross-reference in the 12.5 doc).

## 13. Next safe forks (after 12.6)
- **12.7 — Redaction policy test harness** (verify the "secrets never logged / reports redact" guarantees in 12.5 §3.19 and 12.6 §10).
- **12.8 — Audit report schema** — the report contract every action emits: [`ops-executor-audit-report-schema-phase-12-8.md`](./ops-executor-audit-report-schema-phase-12-8.md).
- **Real SDXL endpoint live test** (image track — independent of ops execution).
