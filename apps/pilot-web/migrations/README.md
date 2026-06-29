# MigraPilot memory — pgvector backend (Phase 9.4)

MigraPilot memory has **two interchangeable backends**:

| Backend | When used | Storage |
|---|---|---|
| **file** (default) | always, unless pgvector is explicitly enabled | `.pilot-data/*.json` (local, git-ignored) |
| **pgvector** (dormant) | `PILOT_MEMORY_BACKEND=pgvector` **and** `DATABASE_URL` set, DB reachable, migration applied, `pg` installed | Postgres tables `pilot_sources` / `pilot_chunks` / `pilot_embeddings` |

The public API (`ingestSource`, `ingestBatch`, `searchKnowledge`, `retrieveContext`,
`listSources`, `knowledgeStats`) and all routes/tools are backend-agnostic — the dispatcher in
`lib/pilot/knowledge.ts` chooses the backend at runtime. **If pgvector init fails for any reason
(no `pg`, DB down, extension/tables missing) it logs a warning and falls back to file memory.**

> ✅ **Verified (Phase 10.0)** against a dev PostgreSQL 16 + **pgvector 0.6** target: apply
> migration → ingest → list → search → re-ingest (no duplicate chunks) → delete (memory rows
> only; the source file is never touched) → fallback to file when env is unset. The default
> (file) backend remains the untouched default.
>
> **Recall note:** the ivfflat index defaults to `probes=1`, which silently misses on small or
> list-misaligned data. `searchVectors` now sets `ivfflat.probes` high (pgvector caps it at
> `lists`) so recall is exact at MigraPilot's scale. For very large corpora, prefer an HNSW index
> (see the comment in `0001_pilot_pgvector.sql`).

## Environment variables
| Var | Default | Purpose |
|---|---|---|
| `PILOT_MEMORY_BACKEND` | _(unset → file)_ | set to `pgvector` to enable Postgres memory |
| `DATABASE_URL` | _(unset)_ | `postgres://USER:PASS@HOST:5432/DBNAME` (required for pgvector) |
| `PILOT_EMBED_MODEL` | `nomic-embed-text` | embedding model (768-dim; must match the `vector(768)` column) |

## Apply the migration
```bash
psql "$DATABASE_URL" -f apps/pilot-web/migrations/0001_pilot_pgvector.sql
```
Requires the `vector` (pgvector) extension to be available on the server. The migration is
**non-destructive and idempotent** (`IF NOT EXISTS`, no `DROP`).

## Enable pgvector in MigraPilot
```bash
cd apps/pilot-web
npm install pg            # driver is lazily imported; only needed when pgvector is enabled
export DATABASE_URL="postgres://USER:PASS@HOST:5432/DBNAME"
export PILOT_MEMORY_BACKEND=pgvector
# restart the app (e.g. npm run dev -- -p 3399)
```

## Verify once a DB is available
```bash
# backend should report "pgvector"
curl -s localhost:3399/api/pilot/sources | python3 -c 'import sys,json;d=json.load(sys.stdin);print("backend:",d["backend"],"sources:",d["sourceCount"])'

# ingest, search, re-ingest (no duplicate chunks)
curl -s -X POST localhost:3399/api/pilot/sources/ingest       -d '{"path":"migrapilot/rules.md"}'        -H 'content-type: application/json'
curl -s -X POST localhost:3399/api/pilot/sources/search       -d '{"query":"what requires approval","k":3}' -H 'content-type: application/json'
curl -s -X POST localhost:3399/api/pilot/sources/ingest       -d '{"path":"migrapilot/rules.md"}'        -H 'content-type: application/json'  # re-ingest: chunk count must NOT double
curl -s localhost:3399/api/pilot/sources | python3 -c 'import sys,json;print(json.load(sys.stdin))'
```
The UI **Sources → Knowledge Store** panel shows the active **Backend: file / pgvector**.

## Rollback
Set `PILOT_MEMORY_BACKEND` back to unset (or anything other than `pgvector`) and restart —
MigraPilot returns to file-backed memory. (The Postgres tables are left intact; drop them
manually if you want, but the migration never drops anything.)

---

# Database backends — apply order & production checklist (Phase 10.0, updated 12.1)

MigraPilot has **three** optional, independent Postgres-backed systems. All default OFF.

| System | Migration | Enable with | Default when unset |
|---|---|---|---|
| pgvector memory | `0001_pilot_pgvector.sql` | `PILOT_MEMORY_BACKEND=pgvector` | file (`.pilot-data`) |
| approval store | `0002_pilot_approvals.sql` | `PILOT_APPROVAL_STORE=postgres` | in-memory |
| ops action journal | `0003_pilot_ops_action_journal.sql` | `PILOT_OPS_ACTION_JOURNAL=postgres` | in-memory |

See [`../docs/approvals.md`](../docs/approvals.md) for the approval store env vars and lifecycle.

> ✅ **Verified (Phase 12.1)** — all three backends were applied to a fresh dev PostgreSQL 16 +
> pgvector 0.6 database and exercised end-to-end (ingest/search/reingest-no-dup/delete-keeps-file;
> persisted approval + exact-once claim + cancel + TTL expiry + blocked-refusal + sanitized args;
> no-op/status-marker/transition/webhook journal records, append-only, secrets stripped), plus
> combined mode and fallback-to-default when env is unset. NOT yet run against a production DB.

## Apply order (manual only — the app never auto-migrates)
```bash
psql "$DATABASE_URL" -f apps/pilot-web/migrations/0001_pilot_pgvector.sql            # memory (needs `vector` ext)
psql "$DATABASE_URL" -f apps/pilot-web/migrations/0002_pilot_approvals.sql           # approvals
psql "$DATABASE_URL" -f apps/pilot-web/migrations/0003_pilot_ops_action_journal.sql  # ops action journal
```
`CREATE EXTENSION vector` requires a superuser (or a role with `CREATE` on the DB) — run the
extension/migration as such, then `GRANT` table privileges to the app role.

## Env vars
| Var | Default | Purpose |
|---|---|---|
| `PILOT_MEMORY_BACKEND` | _(unset → file)_ | `pgvector` to enable Postgres memory |
| `PILOT_APPROVAL_STORE` | _(unset → memory)_ | `postgres` to persist approvals (+ `PILOT_APPROVAL_TTL_MS`, `PILOT_APPROVAL_FAIL_CLOSED`) |
| `PILOT_OPS_ACTION_JOURNAL` | _(unset → memory)_ | `postgres` to persist the ops action journal (+ `PILOT_OPS_ACTION_JOURNAL_FAIL_CLOSED`) |
| `DATABASE_URL` | _(unset)_ | required by any `postgres`/`pgvector` mode; never commit it |

## Production enablement checklist
1. Use a **dedicated, non-production** database first; verify the steps above.
2. Apply `0001` → `0002` → `0003` to the target DB. Confirm: `\d pilot_sources`, `\d pilot_approvals`, `\d pilot_ops_action_journal`.
3. Install the driver: `npm install pg` (lazily imported; only needed when a backend is enabled).
4. Set `DATABASE_URL` (never commit it) + the enable flag(s).
5. Restart; confirm `GET /api/pilot/sources` → `backend: pgvector`, `GET /api/pilot/approvals` → `store: postgres`, and `GET /api/pilot/ops/actions/journal` → `store: postgres`.
6. Verify one ingest + search, one approve/cancel, and one approved no-op/marker before relying on it.

## Rollback / disable
Unset `PILOT_MEMORY_BACKEND`, `PILOT_APPROVAL_STORE`, and `PILOT_OPS_ACTION_JOURNAL` (and/or
`DATABASE_URL`) and restart — MigraPilot returns to file memory + in-memory approvals + in-memory
ops journal. Each backend also falls back to its in-memory default automatically if Postgres is
unreachable (unless its `*_FAIL_CLOSED` flag is set). Tables are left intact (no DROP).
