# MigraAI Durable State

The MigraAI Engine owns durable, engine-only records; clients never connect to the
store. The first real adapter is **embedded SQLite** (`node:sqlite`) — right for the
local single-process engine (transactional, zero-dependency, survives restart). The
storage abstraction (four persistence interfaces) keeps **PostgreSQL + pgvector**
available as a drop-in adapter for a hosted/multi-tenant deployment.

## What persists

`conversations`, `conversation_messages`, `conversation_summaries`, `memory_items`,
`workspace_indexes`, `index_chunks` (with Float32 vector BLOBs), `index_versions`,
`embedding_cache`, plus `schema_meta` (schema version + migration state). RAG index
**approval state** persists on the index row; **model** qualification stays in
`model-qualification.json` (already durable on disk).

Retention rules: `durable` conversations persist; `session` conversations are
in-memory only (never persisted); `off` stores nothing.

### Operational Data Foundation (schema v2)

The engine's **operational evidence** is durable across restarts so decisions rest
on real history, not runtime memory. Schema v2 adds six metadata-only tables:
`op_audit_events`, `op_usage_records`, `op_incidents`, `op_recovery_events`,
`op_budget_scopes`, `op_reservations`. See
[operations/migrapilot-operational-data-foundation.md](operations/migrapilot-operational-data-foundation.md)
for the full contract (what persists / what never does, hydration, retention,
health, recovery). **Metadata only** — never prompts, completions, source, diffs,
approval tokens, proposal bodies, secrets, credentials, or raw paths.

## Configuration

- `MIGRAPILOT_STATE_DB` — path to the SQLite file (default `migraai-state.db` in the
  brain-service working dir). Set to `off` to run stateless (tests do this).

## Readiness (a running process ≠ ready)

`GET /health` now reports a `readiness` block distinguishing:

```
process              running
inferenceProviders   available | unavailable
persistence/memory   ready | degraded | unavailable
rag                  ready | degraded | unavailable
schemaVersion        <n>
migrationState       applied | pending | mismatch | failed | disabled
```

Fail-closed: if durable state was expected but is not ready (DB open failure or a
**schema newer than this build** → `mismatch`), the engine reports **degraded** and
never claims full `ok`. It does not silently serve empty durable memory/indexes.

## Guarantees (tested)

- Durable conversations/messages/summaries + approved indexes survive restart.
- Message order + immutability preserved on reload; summary source bindings preserved.
- Deleted conversations remain inaccessible after restart (hard cascade delete).
- **Unchanged files are not re-embedded after restart** (vectors hydrate from disk;
  embedding cache is keyed by `(model, version, content_hash)` so a vector from one
  model/version is never reused for another).
- Changed/deleted files invalidate stale chunks.
- A failed sync transaction preserves the previous durable index version (never a
  partial write); the index is marked `degraded`.
- Owner + workspace isolation — a cross-workspace read is impossible even with a
  known resource id, before and after restart.
- Secrets are redacted at the boundary before anything reaches the store.

**Verified end-to-end** by `scripts/validate-restart.mjs`: create a durable
conversation + approved index → kill the brain → restart → conversation resumes,
index survives, retrieval works, re-sync is ~16 ms vs ~2.9 s first sync (no
re-embedding), cross-workspace reads denied.

## Recovery runbook

All commands operate on the SQLite file at `MIGRAPILOT_STATE_DB`. **Do not make
automatic destructive repair decisions** — these are operator actions.

- **Backup (online, safe while running):** `store.backupTo('/path/state-YYYYMMDD.db')`
  (uses `VACUUM INTO`), or simply copy the file when the engine is stopped.
- **Restore:** stop the engine, replace `MIGRAPILOT_STATE_DB` with the backup file,
  start the engine (it hydrates on startup). Verified by the "restore from backup"
  test.
- **Integrity verification:** `store.integrityCheck()` → `PRAGMA integrity_check`
  (returns `ok` or the first problem). Run before trusting a recovered file.
- **Orphaned index-version cleanup:** `store.cleanupOrphanVersions()` removes
  `index_versions` / `index_chunks` rows with no matching index.
- **Embedding-cache pruning (retention hook):** `store.pruneOlderThan(cutoffMs)`
  deletes cache rows older than a cutoff; returns the number pruned.
- **Expired-session cleanup:** none needed — sessions are never persisted.
- **Safe index rebuild:** `DELETE /api/ai/indexes/:id` then re-create + `POST
  /:id/sync`. This re-embeds from scratch; the embedding cache makes it cheap.

## Migration

`schema_meta.schema_version` records the applied version. On startup the adapter
creates/upgrades tables. A DB whose version is **ahead** of the engine build is
incompatible → the adapter throws → the engine reports `migrationState: mismatch`
and `persistence: unavailable` (fail-closed; no misleading "ready").

## Hosted deployment (future)

A `PostgresDurableStore` implementing the same four interfaces (with `pgvector` for
`index_chunks.vector`) backs a shared/multi-tenant engine. Because scope columns
(owner, workspace) are on every row, that adapter can enforce isolation in `WHERE`
clauses natively. The engine code does not change.
