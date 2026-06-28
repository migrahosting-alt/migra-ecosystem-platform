-- ============================================================================
-- MigraPilot — pgvector memory schema (Phase 9.4)
-- ============================================================================
-- Non-destructive. Idempotent (IF NOT EXISTS). NO DROP statements.
--
-- WHAT THIS IS:
--   Optional Postgres + pgvector backend for MigraPilot knowledge memory.
--   Default memory is file-backed (.pilot-data/*.json); this schema is only used
--   when PILOT_MEMORY_BACKEND=pgvector AND DATABASE_URL are set.
--
-- PREREQUISITES:
--   - PostgreSQL 13+ with the pgvector extension AVAILABLE on the server
--     (i.e. the `vector` extension is installed/whitelisted so CREATE EXTENSION works).
--   - The embedding model is nomic-embed-text => vectors are 768 dimensions.
--     If you change PILOT_EMBED_MODEL, change vector(768) to match its dimension.
--
-- HOW TO APPLY (run against your target database):
--     psql "$DATABASE_URL" -f apps/pilot-web/migrations/0001_pilot_pgvector.sql
--   (or paste into any SQL client connected to the target DB)
--
-- ENABLE in MigraPilot after applying:
--     1) npm install pg            (in apps/pilot-web — the driver is lazily imported)
--     2) export DATABASE_URL=postgres://USER:PASS@HOST:5432/DBNAME
--     3) export PILOT_MEMORY_BACKEND=pgvector
--     4) restart the app
--   If pg is missing / DB is down / this migration was not applied, MigraPilot logs a
--   warning and falls back to file-backed memory automatically.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS pilot_sources (
  id          text        PRIMARY KEY,
  path        text        NOT NULL UNIQUE,
  title       text        NOT NULL,
  hash        text        NOT NULL,
  bytes       integer     NOT NULL DEFAULT 0,
  chunk_count integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pilot_chunks (
  id        text    PRIMARY KEY,
  source_id text    NOT NULL REFERENCES pilot_sources(id) ON DELETE CASCADE,
  idx       integer NOT NULL,
  text      text    NOT NULL
);
CREATE INDEX IF NOT EXISTS pilot_chunks_source_idx ON pilot_chunks (source_id);

CREATE TABLE IF NOT EXISTS pilot_embeddings (
  chunk_id  text        PRIMARY KEY REFERENCES pilot_chunks(id) ON DELETE CASCADE,
  embedding vector(768) NOT NULL
);

-- Approximate-nearest-neighbour index for cosine distance (operator <=>).
-- ivfflat works on pgvector 0.4+. If your pgvector is >= 0.5.0 you may prefer HNSW:
--   CREATE INDEX IF NOT EXISTS pilot_embeddings_hnsw
--     ON pilot_embeddings USING hnsw (embedding vector_cosine_ops);
-- Search is correct WITHOUT any index (sequential scan); the index only speeds it up.
CREATE INDEX IF NOT EXISTS pilot_embeddings_ivf
  ON pilot_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
