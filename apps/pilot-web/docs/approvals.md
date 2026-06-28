# MigraPilot Action Approvals — storage & lifecycle

Every mutating tool call is gated by the policy layer (Phase 9.6). When a call requires
approval the run **pauses** and a pending approval is recorded; the user approves or
cancels it from the command center. Phase 9.9 makes that approval record **durable and
auditable** behind a storage abstraction.

Source: [`lib/pilot/approval-store.ts`](../lib/pilot/approval-store.ts),
[`lib/pilot/approval-store-pg.ts`](../lib/pilot/approval-store-pg.ts).

## Default: in-memory store

By default approvals live in an in-memory map pinned to `globalThis`. This is the dev/
single-instance default and requires no database. **Approvals reset when the server
restarts** — durable storage is the optional Postgres mode below.

## Optional: persistent Postgres store (dormant)

Enable with environment variables — it is dormant and never required in default mode:

| Var | Default | Purpose |
|---|---|---|
| `PILOT_APPROVAL_STORE` | `memory` | Set to `postgres` to use the durable store. |
| `DATABASE_URL` | _(unset)_ | Postgres connection string. Required for `postgres` mode. |
| `PILOT_APPROVAL_TTL_MS` | `3600000` (1h) | Pending approvals auto-expire after this. |
| `PILOT_APPROVAL_FAIL_CLOSED` | `0` | When `1`/`true`, a Postgres init failure throws instead of falling back to memory. |

If `postgres` mode cannot initialize (missing `pg` package, unreachable DB, or the
migration has not been applied), the dispatcher **falls back to the in-memory store**
unless `PILOT_APPROVAL_FAIL_CLOSED` is set. The `pg` package is imported lazily, so
default builds never depend on it.

### Apply the migration (manual only — the app never auto-migrates)

```bash
psql "$DATABASE_URL" -f migrations/0002_pilot_approvals.sql
# verify
psql "$DATABASE_URL" -c "\d pilot_approvals"
```

The migration is non-destructive and idempotent (`IF NOT EXISTS`, no `DROP`/`TRUNCATE`).

## Lifecycle & exact-once execution

```
pending ──approve(claim)──▶ approved ──run──▶ executed
   │                           └──re-classify blocked──▶ blocked
   ├──cancel──▶ cancelled
   └──TTL elapsed──▶ expired
```

- **Exact-once:** the `pending → approved` transition is an **atomic claim** (a conditional
  update in Postgres; a synchronous compare-and-set in memory). A second concurrent
  approve loses the race and gets `409 approval already approved/executed`.
- **Re-classification:** on approval the **exact stored** action/args are re-run through
  `classifyPilotAction`. A blocked verdict marks the approval `blocked` and **never executes**,
  even though a record exists and the user approved.
- **Cancelled / expired** approvals can never execute.

## Security model

- Stored `args` are **sanitized**: keys matching `secret|token|password|key|credential|
  authorization|cookie|api_key` are stripped before storage, so no secrets are persisted.
  Stored args == executed args, so the action binding stays exact.
- An `args_digest` (sha256 prefix) is kept for traceability without bloating storage.
- API responses (`GET /api/pilot/approvals`) return **summaries only** — never raw args.
- The approve route never echoes secrets; tool output stored in `detail` is truncated.

## Audit fields

`id`, `runId`, `stepId`, `toolName`, sanitized `args` + `argsDigest`, `risk`, `reason`,
`expectedEffect`, `summary`, `status`, `detail`, `createdAt`, `updatedAt`, `expiresAt`,
`executedAt`.

## API

- `POST /api/pilot/runs/:id/approve` — `{ approvalId, decision: "approve" | "deny" }`.
  Atomic claim/cancel, then executes once (approve) or skips (deny), then resumes the run.
  Returns `409` if the approval is no longer pending. **Cancel** in the UI uses `decision:"deny"`.
- `GET /api/pilot/approvals?limit=N` — recent approval **summaries** (default 20, max 100),
  plus the active `store` name (`memory` | `postgres`).

## Limitations

- Default in-memory mode does not survive restart (Postgres mode does).
- If a process crashes after claiming but before executing, the approval is left `approved`
  (not `executed`) and is **not** retried — a safe direction (no double execution).
- `expired` is enforced lazily (on read / claim), not by a background sweeper.
- The Postgres backend was **verified (Phase 10.0)** against a dev PostgreSQL 16 target:
  persisted row, exact-once claim, cancel, TTL expiry, blocked-never-executes, and sanitized
  args (no secrets stored). See [`../migrations/README.md`](../migrations/README.md) for the
  apply order and production checklist. It has not yet been run against a production database.
