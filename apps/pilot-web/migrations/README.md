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

> ⚠️ The pgvector backend is **implemented but NOT live-verified** — this environment had no
> Postgres/pgvector available. The default (file) backend is fully tested.

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
