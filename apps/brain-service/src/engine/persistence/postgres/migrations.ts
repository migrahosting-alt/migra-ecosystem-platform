/**
 * MigraAI Engine — PostgreSQL migrations.
 *
 * Migrations are embedded as TypeScript rather than loose `.sql` files on
 * purpose: `tsc` does not copy non-TS assets into `dist/`, so a file-based
 * migration set would compile cleanly and then fail at runtime in a packaged
 * release. Embedding makes the built artifact self-contained.
 *
 * Rules:
 *   • migrations are append-only and never edited once released
 *   • each runs inside a transaction; a failure leaves no partial version
 *   • the applied version is recorded in `schema_meta`, mirroring the SQLite
 *     adapter's existing precedent (`schema_meta(key, value)`)
 *
 * Tenant isolation is a SCHEMA property here, not a convention: every
 * ownership-scoped table carries NOT NULL owner/workspace columns, and indexes
 * lead with that scope so a query that forgets the filter is a sequential scan
 * that still cannot cross a tenant boundary once RLS (migration 2) is enabled.
 */

// Migration 7 lives in its own module only because of size — its four tables
// carry 105 derived column definitions, which would bury the rest of this file.
import { M7_AGENT_RUNS } from './agentRunSchema.js';
import { M8_OPERATIONAL } from './operationalSchema.js';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

const M1_FOUNDATION = `
-- Version bookkeeping. Mirrors the SQLite adapter's schema_meta contract.
CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Applied-migration ledger: which versions ran, when, and how long they took.
-- Distinct from schema_meta so "current version" and "migration history" are
-- separately auditable.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     INTEGER PRIMARY KEY,
  name        TEXT        NOT NULL,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_ms INTEGER     NOT NULL
);

-- Advisory-lock helper table is unnecessary; pg_advisory_lock is used directly
-- by the runner so concurrent engine starts cannot race the same migration.
`;

/**
 * Migration 2 establishes the tenancy primitives every scoped table will use in
 * sub-slice 2. Defining them once here keeps every later table consistent, and
 * makes cross-tenant access a schema-level impossibility rather than a review
 * checklist item.
 */
const M2_TENANCY = `
-- Canonical scope type. Owner and workspace are ALWAYS present together.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'migra_scope') THEN
    CREATE DOMAIN migra_scope AS TEXT
      CHECK (VALUE IS NOT NULL AND length(VALUE) BETWEEN 1 AND 200);
  END IF;
END $$;

-- Session-scoped tenant context. Row-level security policies read these, so a
-- connection that has not declared its scope sees nothing.
CREATE OR REPLACE FUNCTION migra_current_owner() RETURNS TEXT AS $$
  SELECT nullif(current_setting('migrapilot.owner_scope', true), '');
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION migra_current_workspace() RETURNS TEXT AS $$
  SELECT nullif(current_setting('migrapilot.workspace_scope', true), '');
$$ LANGUAGE sql STABLE;
`;

/**
 * Group 1 — conversations, messages, summaries.
 *
 * Two DELIBERATE, documented differences from the SQLite schema:
 *
 *  1. `owner_scope` / `workspace_scope` are DENORMALISED onto messages and
 *     summaries. SQLite scopes them transitively through `conversation_id`,
 *     which RLS cannot express reliably — a policy that joins is a policy that
 *     can be defeated by a planner choice or a missing index. Carrying the
 *     scope on the row makes isolation a property of the row itself.
 *
 *  2. Epoch milliseconds are stored as BIGINT, not TIMESTAMPTZ. This preserves
 *     SQLite's exact integer values, so timestamp precision needs no
 *     normalisation at the boundary and round-trips are bit-identical.
 *
 * `ins_seq BIGSERIAL` replaces SQLite's implicit `rowid`, which `loadDurable`
 * uses as the final ordering tie-break.
 */
const M3_CONVERSATIONS = `
CREATE TABLE IF NOT EXISTS conversations (
  id              TEXT PRIMARY KEY,
  owner_scope     migra_scope NOT NULL,
  workspace_scope migra_scope NOT NULL,
  title           TEXT,
  memory_mode     TEXT,
  created_at      BIGINT,
  updated_at      BIGINT,
  deleted_at      BIGINT,
  ins_seq         BIGSERIAL
);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  owner_scope     migra_scope NOT NULL,
  workspace_scope migra_scope NOT NULL,
  role            TEXT,
  content         TEXT,
  status          TEXT,
  request_id      TEXT,
  model_id        TEXT,
  provider_id     TEXT,
  created_at      BIGINT,
  durable         BOOLEAN,
  supersedes_id   TEXT,
  seq             BIGINT,
  ins_seq         BIGSERIAL
);

CREATE TABLE IF NOT EXISTS conversation_summaries (
  id                     TEXT PRIMARY KEY,
  conversation_id        TEXT NOT NULL,
  owner_scope            migra_scope NOT NULL,
  workspace_scope        migra_scope NOT NULL,
  source_from_message_id TEXT,
  source_to_message_id   TEXT,
  summary_json           TEXT,
  version                BIGINT,
  created_at             BIGINT,
  ins_seq                BIGSERIAL
);

-- Scope-leading indexes: every legitimate read is scoped, so the scope belongs
-- at the front of the key.
CREATE INDEX IF NOT EXISTS conversations_scope_idx
  ON conversations (owner_scope, workspace_scope, deleted_at);
CREATE INDEX IF NOT EXISTS conversation_messages_scope_order_idx
  ON conversation_messages (owner_scope, workspace_scope, conversation_id, seq, ins_seq);
CREATE INDEX IF NOT EXISTS conversation_summaries_scope_order_idx
  ON conversation_summaries (owner_scope, workspace_scope, conversation_id, version);

-- ── Row-level security ─────────────────────────────────────────────────────
-- The FINAL enforcement layer, not a second predicate. A query that forgets its
-- owner filter returns nothing rather than everything, and an unset scope
-- (NULL) matches no row because NULL = anything is never true.
ALTER TABLE conversations           ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_messages   ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_summaries  ENABLE ROW LEVEL SECURITY;

-- FORCE so the table owner is subject to policy too; without it a superuser or
-- owner connection silently bypasses the boundary we are relying on.
ALTER TABLE conversations           FORCE ROW LEVEL SECURITY;
ALTER TABLE conversation_messages   FORCE ROW LEVEL SECURITY;
ALTER TABLE conversation_summaries  FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversations_scope ON conversations;
CREATE POLICY conversations_scope ON conversations
  USING (owner_scope = migra_current_owner() AND workspace_scope = migra_current_workspace())
  WITH CHECK (owner_scope = migra_current_owner() AND workspace_scope = migra_current_workspace());

DROP POLICY IF EXISTS conversation_messages_scope ON conversation_messages;
CREATE POLICY conversation_messages_scope ON conversation_messages
  USING (owner_scope = migra_current_owner() AND workspace_scope = migra_current_workspace())
  WITH CHECK (owner_scope = migra_current_owner() AND workspace_scope = migra_current_workspace());

DROP POLICY IF EXISTS conversation_summaries_scope ON conversation_summaries;
CREATE POLICY conversation_summaries_scope ON conversation_summaries
  USING (owner_scope = migra_current_owner() AND workspace_scope = migra_current_workspace())
  WITH CHECK (owner_scope = migra_current_owner() AND workspace_scope = migra_current_workspace());
`;

/**
 * The application role.
 *
 * CRITICAL: PostgreSQL superusers — and any role with BYPASSRLS — ignore row
 * level security completely. `FORCE ROW LEVEL SECURITY` does not change that.
 * A Brain connected as `postgres` therefore has NO tenant isolation whatsoever,
 * while every policy still appears correctly configured in the catalogue.
 *
 * This was caught by the "RLS is the final layer" test, which failed while the
 * flags and policies all looked right.
 *
 * `migrapilot_app` is NOLOGIN by design: migrations must not invent
 * credentials. Provisioning grants it to a login role, or gives it LOGIN with a
 * managed password, per MigraTeck database standards.
 */
const M4_APP_ROLE = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migrapilot_app') THEN
    CREATE ROLE migrapilot_app NOLOGIN NOBYPASSRLS;
  ELSIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migrapilot_app' AND rolbypassrls) THEN
    -- ONLY when the attribute is actually wrong.
    --
    -- Roles are CLUSTER-wide, so on any server where migrapilot_app already
    -- exists this branch runs on every fresh database. ALTER ROLE ... NOBYPASSRLS
    -- is superuser-only, so running it unconditionally made the migration
    -- undeployable by the database owner: the Brain failed to start, and every
    -- scratch-database test failed, purely because the role was already in the
    -- state being asked for.
    --
    -- Attempting it only when the role really can bypass RLS keeps the security
    -- intent exactly: a genuinely unsafe role still raises loudly and demands
    -- superuser attention, rather than being silently tolerated.
    ALTER ROLE migrapilot_app NOBYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO migrapilot_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON conversations          TO migrapilot_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON conversation_messages  TO migrapilot_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON conversation_summaries TO migrapilot_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO migrapilot_app;

-- Read-only on bookkeeping: the app reports schema version but never rewrites it.
GRANT SELECT ON schema_meta        TO migrapilot_app;
GRANT SELECT ON schema_migrations  TO migrapilot_app;

-- Future tables created by later migrations inherit these grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO migrapilot_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO migrapilot_app;
`;

/**
 * Group 2 — memory items, workspaces, workspace indexes.
 *
 * Deliberate, documented differences from SQLite:
 *
 *  1. Scope columns are NOT NULL. `MemoryItem.scope` marks owner/workspace as
 *     optional, and SQLite happily stores NULLs — but a NULL-scoped row under
 *     RLS is either invisible to everyone or visible to everyone, and neither
 *     is a defensible answer. The adapter refuses to persist an unscoped item.
 *
 *  2. `workspace_indexes` gains `workspace_scope`. SQLite carries only
 *     `owner_scope`, which would let a caller who learns another tenant's
 *     workspace id reach its indexes. Both dimensions are now required.
 */
const M5_MEMORY_WORKSPACES = `
CREATE TABLE IF NOT EXISTS memory_items (
  id              TEXT PRIMARY KEY,
  owner_scope     migra_scope NOT NULL,
  workspace_scope migra_scope NOT NULL,
  category        TEXT,
  content         TEXT,
  confidence      DOUBLE PRECISION,
  source_type     TEXT,
  source_id       TEXT,
  expires_at      BIGINT,
  created_at      BIGINT,
  ins_seq         BIGSERIAL
);

CREATE TABLE IF NOT EXISTS workspaces (
  id                   TEXT PRIMARY KEY,
  owner_scope          migra_scope NOT NULL,
  workspace_scope      migra_scope NOT NULL,
  name                 TEXT,
  root                 TEXT,
  git_repo             TEXT,
  git_branch           TEXT,
  memory_mode          TEXT,
  index_id             TEXT,
  provider_preferences TEXT,
  permissions          TEXT,
  last_sync_at         BIGINT,
  created_at           BIGINT,
  updated_at           BIGINT,
  ins_seq              BIGSERIAL
);

CREATE TABLE IF NOT EXISTS workspace_indexes (
  id                TEXT PRIMARY KEY,
  workspace_id      TEXT,
  owner_scope       migra_scope NOT NULL,
  workspace_scope   migra_scope NOT NULL,
  source_type       TEXT,
  root              TEXT,
  state             TEXT,
  version           BIGINT,
  embedding_model   TEXT,
  embedding_version TEXT,
  created_at        BIGINT,
  updated_at        BIGINT,
  approved_version  BIGINT,
  ins_seq           BIGSERIAL
);

CREATE INDEX IF NOT EXISTS memory_items_scope_idx
  ON memory_items (owner_scope, workspace_scope, created_at);
CREATE INDEX IF NOT EXISTS workspaces_scope_idx
  ON workspaces (owner_scope, workspace_scope, id);
CREATE INDEX IF NOT EXISTS workspace_indexes_scope_idx
  ON workspace_indexes (owner_scope, workspace_scope, workspace_id);

ALTER TABLE memory_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces        ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_indexes ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_items      FORCE ROW LEVEL SECURITY;
ALTER TABLE workspaces        FORCE ROW LEVEL SECURITY;
ALTER TABLE workspace_indexes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS memory_items_scope ON memory_items;
CREATE POLICY memory_items_scope ON memory_items
  USING (owner_scope = migra_current_owner() AND workspace_scope = migra_current_workspace())
  WITH CHECK (owner_scope = migra_current_owner() AND workspace_scope = migra_current_workspace());

DROP POLICY IF EXISTS workspaces_scope ON workspaces;
CREATE POLICY workspaces_scope ON workspaces
  USING (owner_scope = migra_current_owner() AND workspace_scope = migra_current_workspace())
  WITH CHECK (owner_scope = migra_current_owner() AND workspace_scope = migra_current_workspace());

DROP POLICY IF EXISTS workspace_indexes_scope ON workspace_indexes;
CREATE POLICY workspace_indexes_scope ON workspace_indexes
  USING (owner_scope = migra_current_owner() AND workspace_scope = migra_current_workspace())
  WITH CHECK (owner_scope = migra_current_owner() AND workspace_scope = migra_current_workspace());

GRANT SELECT, INSERT, UPDATE, DELETE ON memory_items      TO migrapilot_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON workspaces        TO migrapilot_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_indexes TO migrapilot_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO migrapilot_app;
`;

/**
 * Group 3 — RAG: index versions, chunks, embedding cache.
 *
 * NO pgvector. Justified by the actual query path, not by availability:
 * `RagIndexPersistence` exposes only `loadChunks(indexId, version)`, a bulk
 * version-scoped load. Similarity ranking happens OUTSIDE the store, in
 * `engine/rag/vectorIndex.ts` and `hybridRetriever.ts`. The store is a
 * byte-faithful vector container, so vectors are stored as BYTEA holding the
 * identical little-endian Float32 encoding SQLite uses. Round-trips are
 * bit-identical and no distance metric is implied. ANN indexing (HNSW/IVFFlat)
 * belongs to a later performance slice, once a similarity path exists here.
 *
 * `embedding_cache` is GLOBAL-SAFE and deliberately has no RLS — see
 * ragRepo.ts for the field-by-field justification and its one caveat.
 */
const M6_RAG = `
CREATE TABLE IF NOT EXISTS index_versions (
  index_id        TEXT NOT NULL,
  version         BIGINT NOT NULL,
  owner_scope     migra_scope NOT NULL,
  workspace_scope migra_scope NOT NULL,
  committed_at    BIGINT,
  PRIMARY KEY (index_id, version)
);

CREATE TABLE IF NOT EXISTS index_chunks (
  id                TEXT PRIMARY KEY,
  index_id          TEXT,
  workspace_id      TEXT,
  owner_scope       migra_scope NOT NULL,
  workspace_scope   migra_scope NOT NULL,
  file_path         TEXT,
  language          TEXT,
  symbol            TEXT,
  start_line        BIGINT,
  end_line          BIGINT,
  content_hash      TEXT,
  embedding_model   TEXT,
  embedding_version TEXT,
  indexed_at        BIGINT,
  text              TEXT,
  vector            BYTEA,
  index_version     BIGINT,
  ins_seq           BIGSERIAL
);

-- GLOBAL-SAFE: no tenant identifier, no source text, no path, no provenance.
-- Keyed by (model, version, content_hash); the value is a deterministic
-- function of content the caller already holds. No RLS by design.
CREATE TABLE IF NOT EXISTS embedding_cache (
  model        TEXT NOT NULL,
  version      TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  dims         INTEGER,
  vector       BYTEA,
  created_at   BIGINT,
  PRIMARY KEY (model, version, content_hash)
);

CREATE INDEX IF NOT EXISTS index_chunks_scope_version_idx
  ON index_chunks (owner_scope, workspace_scope, index_id, index_version);
CREATE INDEX IF NOT EXISTS index_versions_scope_idx
  ON index_versions (owner_scope, workspace_scope, index_id, version);
CREATE INDEX IF NOT EXISTS embedding_cache_created_idx
  ON embedding_cache (created_at);

ALTER TABLE index_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE index_chunks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE index_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE index_chunks   FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS index_versions_scope ON index_versions;
CREATE POLICY index_versions_scope ON index_versions
  USING (owner_scope = migra_current_owner() AND workspace_scope = migra_current_workspace())
  WITH CHECK (owner_scope = migra_current_owner() AND workspace_scope = migra_current_workspace());

DROP POLICY IF EXISTS index_chunks_scope ON index_chunks;
CREATE POLICY index_chunks_scope ON index_chunks
  USING (owner_scope = migra_current_owner() AND workspace_scope = migra_current_workspace())
  WITH CHECK (owner_scope = migra_current_owner() AND workspace_scope = migra_current_workspace());

GRANT SELECT, INSERT, UPDATE, DELETE ON index_versions  TO migrapilot_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON index_chunks    TO migrapilot_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON embedding_cache TO migrapilot_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO migrapilot_app;
`;

/**
 * Conversation-scoped grounding. Purely additive and idempotent: an existing row
 * reads back NULL, which maps to "grounded in nothing" — exactly the behaviour it
 * had before the column existed, so no thread changes meaning on upgrade.
 */
const M9_CONVERSATION_GROUNDING = `
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS grounding_files TEXT;
`;


/**
 * PARENT-SCOPE INTEGRITY.
 *
 * Gate 1 proved a cross-tenant hole that row-level security does not close.
 * RLS answers "does this row belong to the scope I declared?" — and for a child
 * row carrying its OWN scope columns the answer is trivially yes, because the
 * writer stamps them. It never asks "does this child's parent live in that same
 * scope?"
 *
 * Measured, not theorised: with the app role declaring beta's scope, a message
 * was written against a conversation owned by alpha. WITH CHECK passed, because
 * the row said beta and the connection said beta. The result was a structurally
 * valid orphan under the wrong tenant. Worse, no table here had ANY foreign key,
 * so a message could also name a conversation that had never existed.
 *
 * The composite key makes the mismatch unrepresentable rather than unlikely: the
 * child must point at a parent row that matches on id AND both scopes, so a
 * wrong scope becomes a foreign-key violation — the hard failure the design
 * assumed it already had.
 *
 * Applied to every child table with the same shape, not just the two Gate 1
 * exercised. The pattern was repo-wide: five tables, duplicated scope columns,
 * zero foreign keys.
 *
 * DELIBERATELY NO CASCADES. Deletion already has an explicit path
 * (`deleteConversation`), and attaching ON DELETE CASCADE here would change
 * product behaviour as a side effect of an integrity fix.
 *
 * NOT VALID + VALIDATE: the constraint starts guarding new writes immediately
 * while the existing-row check takes a weaker lock. The dataset is small today,
 * but a migration that only works on a small table is a trap for the day it is
 * not.
 */
const M10_PARENT_SCOPE_INTEGRITY = `
-- PREFLIGHT. Refuse rather than repair: silently rewriting rows to satisfy a new
-- constraint would destroy the evidence of how they came to be wrong.
DO $$
DECLARE
  bad_messages   BIGINT;
  bad_summaries  BIGINT;
BEGIN
  SELECT count(*) INTO bad_messages
  FROM conversation_messages m
  WHERE NOT EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = m.conversation_id
      AND c.owner_scope = m.owner_scope
      AND c.workspace_scope = m.workspace_scope
  );

  SELECT count(*) INTO bad_summaries
  FROM conversation_summaries s
  WHERE NOT EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = s.conversation_id
      AND c.owner_scope = s.owner_scope
      AND c.workspace_scope = s.workspace_scope
  );

  IF bad_messages > 0 OR bad_summaries > 0 THEN
    RAISE EXCEPTION
      'parent-scope integrity preflight failed: % orphaned/mismatched messages, % summaries. Investigate before migrating; do not rewrite rows to satisfy the constraint.',
      bad_messages, bad_summaries;
  END IF;
END $$;

-- The identity a child must reference: id plus BOTH scope halves.
ALTER TABLE conversations
  ADD CONSTRAINT conversations_scope_identity_uq
  UNIQUE (id, owner_scope, workspace_scope);

ALTER TABLE conversation_messages
  ADD CONSTRAINT conversation_messages_parent_fk
  FOREIGN KEY (conversation_id, owner_scope, workspace_scope)
  REFERENCES conversations (id, owner_scope, workspace_scope) NOT VALID;
ALTER TABLE conversation_messages VALIDATE CONSTRAINT conversation_messages_parent_fk;

ALTER TABLE conversation_summaries
  ADD CONSTRAINT conversation_summaries_parent_fk
  FOREIGN KEY (conversation_id, owner_scope, workspace_scope)
  REFERENCES conversations (id, owner_scope, workspace_scope) NOT VALID;
ALTER TABLE conversation_summaries VALIDATE CONSTRAINT conversation_summaries_parent_fk;

-- The index chain has the same shape: workspaces -> workspace_indexes ->
-- index_versions -> index_chunks, each child carrying its own scope columns and
-- none of them constrained.
ALTER TABLE workspaces
  ADD CONSTRAINT workspaces_scope_identity_uq
  UNIQUE (id, owner_scope, workspace_scope);

ALTER TABLE workspace_indexes
  ADD CONSTRAINT workspace_indexes_scope_identity_uq
  UNIQUE (id, owner_scope, workspace_scope);

ALTER TABLE index_versions
  ADD CONSTRAINT index_versions_parent_fk
  FOREIGN KEY (index_id, owner_scope, workspace_scope)
  REFERENCES workspace_indexes (id, owner_scope, workspace_scope) NOT VALID;
ALTER TABLE index_versions VALIDATE CONSTRAINT index_versions_parent_fk;

ALTER TABLE index_chunks
  ADD CONSTRAINT index_chunks_parent_fk
  FOREIGN KEY (index_id, owner_scope, workspace_scope)
  REFERENCES workspace_indexes (id, owner_scope, workspace_scope) NOT VALID;
ALTER TABLE index_chunks VALIDATE CONSTRAINT index_chunks_parent_fk;
`;


/**
 * SCOPED CHUNK IDENTITY.
 *
 * `index_chunks.id` was `${relPath}#${startLine}` — `handbook.md#1` — while the
 * column was a GLOBAL primary key. Any two indexes holding a file at the same
 * relative path with a chunk at the same start line collided. `README.md#1`
 * would collide across essentially every workspace in the system.
 *
 * Found by the candidate gate: a second tenant indexing the same document hit
 * ON CONFLICT, whose update path evaluated row-level security against the FIRST
 * tenant's row, and PostgreSQL refused with "new row violates row-level security
 * policy (USING expression)".
 *
 * RLS is what turned a silent cross-tenant overwrite into a loud failure. Under
 * SQLite — same ids, no RLS — the second write would simply have REPLACED the
 * first tenant's chunk. That is why the migration utility audits existing rows
 * rather than assuming the current table is intact.
 *
 * TWO IDENTITIES, deliberately separated:
 *
 *   row_id     globally unique persistence identity, derived from the whole
 *              canonical tuple. An implementation detail.
 *   chunk_key  `${relPath}#${startLine}` — the chunk's stable identity INSIDE
 *              its index. What retrieval uses.
 *
 * The composite UNIQUE is what actually documents the domain invariant, and it
 * is what ON CONFLICT now targets — so one tenant can never select another's
 * row as its conflict target. Prefixing the id with indexId alone would have
 * relied on indexId being globally unique, which is a second assumption of
 * exactly the kind that produced this defect.
 */
const M11_SCOPED_CHUNK_IDENTITY = `
ALTER TABLE index_chunks ADD COLUMN IF NOT EXISTS row_id TEXT;
ALTER TABLE index_chunks RENAME COLUMN id TO chunk_key;

/*
 * FORCE ROW LEVEL SECURITY APPLIES TO THE TABLE OWNER TOO.
 *
 * The backfill below is an owner-run maintenance statement with no tenant scope
 * to declare, so under FORCE it matched ZERO rows: row_id stayed NULL on every
 * existing chunk and SET NOT NULL then failed with "contains null values".
 *
 * This was invisible in tests because a scratch database is migrated BEFORE any
 * data exists — there were no rows to miss. It appeared the moment the migration
 * met a database that already held chunks.
 *
 * FORCE is lifted for the owner only, for the duration of this migration, and
 * restored below. The app role is NOT the owner and keeps its policies
 * throughout; if this migration aborts, the whole transaction — including this
 * DDL — rolls back, so FORCE cannot be left off.
 */
ALTER TABLE index_chunks NO FORCE ROW LEVEL SECURITY;

-- Deterministic, from the COMPLETE identity the database already knows. Two
-- rows that are genuinely the same chunk derive the same row_id; two rows that
-- differ in any scope component do not.
UPDATE index_chunks
   SET row_id = encode(
         sha256(convert_to(
           owner_scope || E'\\x1f' || workspace_scope || E'\\x1f' ||
           coalesce(index_id, '') || E'\\x1f' || chunk_key, 'UTF8')),
         'hex')
 WHERE row_id IS NULL;

-- PREFLIGHT. Refuse rather than repair: if legacy rows already collide on the
-- canonical tuple, silently dropping one would destroy content whose loss is
-- exactly what this migration exists to expose.
DO $$
DECLARE
  dupes BIGINT;
BEGIN
  SELECT count(*) INTO dupes FROM (
    SELECT 1 FROM index_chunks
     GROUP BY owner_scope, workspace_scope, index_id, chunk_key
    HAVING count(*) > 1
  ) d;
  IF dupes > 0 THEN
    RAISE EXCEPTION
      'scoped chunk identity preflight failed: % duplicate (owner, workspace, index, chunk_key) groups. Investigate before migrating.',
      dupes;
  END IF;
END $$;

ALTER TABLE index_chunks ALTER COLUMN row_id SET NOT NULL;
ALTER TABLE index_chunks DROP CONSTRAINT IF EXISTS index_chunks_pkey;
ALTER TABLE index_chunks ADD CONSTRAINT index_chunks_pkey PRIMARY KEY (row_id);

-- The actual domain invariant, stated structurally.
ALTER TABLE index_chunks
  ADD CONSTRAINT index_chunks_scope_identity_uq
  UNIQUE (owner_scope, workspace_scope, index_id, chunk_key);

-- Restored immediately. Tenant isolation is not relaxed beyond this migration.
ALTER TABLE index_chunks FORCE ROW LEVEL SECURITY;
`;

/**
 * Migration 13 — chunk identity must include the INDEX VERSION.
 *
 * Migration 11 keyed chunks by (owner, workspace, index, chunk_key). That is
 * scoped correctly and fixed the cross-tenant collision, but it is still too
 * NARROW: it cannot represent the same logical chunk at two index versions.
 *
 * An index legitimately holds `notes.md#1` at v28 and again at v29. Under the
 * migration-11 key the v29 insert takes the v28 row as its conflict target and
 * UPDATES it — so committing a new version silently rewrites the previous
 * version's chunk instead of adding one, and the older version's content is
 * gone. `loadChunks(indexId, 28)` then returns fewer rows than were committed.
 *
 * SQLite never had this problem: its row key was
 * `${indexId}:v${version}:${path}#${line}`, version included.
 *
 * Found by the legacy-import parity test on a fixture built from the real
 * production layout — production holds exactly this shape (one index with
 * chunks at v28 AND v29, another at v2 AND v3), so an import under the old key
 * would have destroyed version history at the moment of migration.
 *
 * No duplicate preflight is needed here: the old constraint is a strict SUBSET
 * of the new one, so any state satisfying it already satisfies this.
 */
const M13_CHUNK_VERSION_IDENTITY = `
-- FORCE row-level security applies to the table OWNER too, so an owner-run
-- maintenance UPDATE matches zero rows while it is on. Lifted only for the
-- recompute, exactly as migration 11 does, and restored below.
ALTER TABLE index_chunks NO FORCE ROW LEVEL SECURITY;

ALTER TABLE index_chunks DROP CONSTRAINT IF EXISTS index_chunks_scope_identity_uq;

UPDATE index_chunks
   SET row_id = encode(sha256(convert_to(
         owner_scope || E'\\x1f' || workspace_scope || E'\\x1f' ||
         coalesce(index_id,'') || E'\\x1f' || index_version::text || E'\\x1f' || chunk_key,
         'UTF8')),
       'hex');

ALTER TABLE index_chunks
  ADD CONSTRAINT index_chunks_scope_identity_uq
  UNIQUE (owner_scope, workspace_scope, index_id, index_version, chunk_key);

ALTER TABLE index_chunks FORCE ROW LEVEL SECURITY;
`;

/**
 * Migration 12 — legacy import bookkeeping.
 *
 * The importer must be resumable: if it dies at conversation 47 of 96, rerunning
 * continues rather than duplicating. That needs durable checkpoints, and they
 * belong in the target database — a checkpoint file next to the process is lost
 * exactly when the process is.
 *
 * NO row-level security here, deliberately. These rows are not tenant data; they
 * are written by the migration tool about the migration itself, and every read
 * of them is an operator read. Enabling RLS would mean inventing an owner scope
 * for a record that has none.
 *
 * `source_fingerprint` is what makes a resume safe: it pins the run to one exact
 * legacy artifact. Resuming against a source that changed underneath would
 * silently interleave two different datasets.
 */
const M12_MIGRATION_RUNS = `
CREATE TABLE IF NOT EXISTS migration_runs (
  run_id              TEXT PRIMARY KEY,
  source_fingerprint  TEXT NOT NULL,
  source_path         TEXT NOT NULL,
  started_at          BIGINT NOT NULL,
  updated_at          BIGINT NOT NULL,
  completed_at        BIGINT,
  status              TEXT NOT NULL,
  verification_status TEXT,
  records_imported    JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes               JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS migration_scope_progress (
  run_id           TEXT NOT NULL REFERENCES migration_runs(run_id) ON DELETE CASCADE,
  owner_scope      TEXT NOT NULL,
  workspace_scope  TEXT NOT NULL,
  stage            TEXT NOT NULL,
  completed_at     BIGINT NOT NULL,
  records_imported JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (run_id, owner_scope, workspace_scope, stage)
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migrapilot_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON migration_runs TO migrapilot_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON migration_scope_progress TO migrapilot_app;
  END IF;
END $$;
`;


/**
 * Migration 14 — anonymous chat quota, as a durable reservation ledger.
 *
 * A signed-out visitor can talk to MigraPilot before signing in. That costs real
 * inference, so it is bounded — and the bound has to be a server-side fact.
 *
 * WHY A LEDGER AND NOT A COUNTER. Incrementing a `used` column after the answer
 * is generated loses every race: two tabs, a double-click, a refresh mid-stream.
 * Each lost race is a free turn. So a turn takes a RESERVATION first, inside a
 * transaction, and settles it afterwards — consumed if the user got output,
 * released if our own infrastructure failed before they did.
 *
 * `used` is therefore DERIVED — consumed rows plus live holds — never stored.
 * A stored total and a set of rows are two sources of truth that drift.
 *
 * Row-level security is scoped by `owner_scope`, which for an anonymous visitor
 * IS their identity (`anon:<opaque>`). Expiry is handled lazily, per session, at
 * reserve time: a cross-scope sweep would need an owner-run statement, and under
 * FORCE row-level security that matches zero rows — the lesson migration 11
 * bought.
 */
const M14_ANONYMOUS_QUOTA = `
CREATE TABLE IF NOT EXISTS anonymous_quota (
  anonymous_session_id TEXT PRIMARY KEY,
  owner_scope          TEXT NOT NULL,
  turn_limit           INTEGER NOT NULL,
  created_at           BIGINT NOT NULL,
  updated_at           BIGINT NOT NULL,
  claimed_by           TEXT,
  claimed_at           BIGINT
);

CREATE TABLE IF NOT EXISTS anonymous_reservations (
  reservation_id       TEXT PRIMARY KEY,
  anonymous_session_id TEXT NOT NULL,
  owner_scope          TEXT NOT NULL,
  -- held: taken, turn in flight. consumed: the user got output.
  -- A released reservation is DELETED: keeping it would mean every derived
  -- count has to remember to exclude it, and one query forgetting is a
  -- permanently wrong quota.
  state                TEXT NOT NULL CHECK (state IN ('held','consumed')),
  created_at           BIGINT NOT NULL,
  expires_at           BIGINT NOT NULL,
  settled_at           BIGINT,
  conversation_id      TEXT,
  CONSTRAINT anonymous_reservations_session_fk
    FOREIGN KEY (anonymous_session_id) REFERENCES anonymous_quota(anonymous_session_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_anon_res_session ON anonymous_reservations (anonymous_session_id, state);

ALTER TABLE anonymous_quota ENABLE ROW LEVEL SECURITY;
ALTER TABLE anonymous_quota FORCE ROW LEVEL SECURITY;
ALTER TABLE anonymous_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE anonymous_reservations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anonymous_quota_scope ON anonymous_quota;
CREATE POLICY anonymous_quota_scope ON anonymous_quota
  USING (owner_scope = migra_current_owner())
  WITH CHECK (owner_scope = migra_current_owner());

DROP POLICY IF EXISTS anonymous_reservations_scope ON anonymous_reservations;
CREATE POLICY anonymous_reservations_scope ON anonymous_reservations
  USING (owner_scope = migra_current_owner())
  WITH CHECK (owner_scope = migra_current_owner());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migrapilot_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON anonymous_quota TO migrapilot_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON anonymous_reservations TO migrapilot_app;
  END IF;
END $$;
`;

const M15_USER_PREFERENCES = `
-- MigraPilot's OWN preferences. Identity stays in MigraAuth.
--
-- The boundary is the point: name, email, avatar, linked providers and sessions
-- are MigraAuth's truth and are never copied here. What lives here is what
-- MigraPilot alone knows how to honour — how an answer should read, what the
-- assistant may do without asking, what it remembers. Duplicating the identity
-- fields would create a second version of "who you are" that drifts the first
-- time someone changes their name in one place.
--
-- ONE ROW PER SCOPE, holding a JSON document rather than a column per setting.
-- Preferences are added and renamed constantly and each one would otherwise be a
-- migration; the shape is validated in code, where the defaults also live, so an
-- unknown key from an older or newer client is ignored instead of rejected.
CREATE TABLE IF NOT EXISTS user_preferences (
  owner_scope     TEXT PRIMARY KEY,
  workspace_scope TEXT NOT NULL,
  -- Validated by \`preferences.ts\` before it is written. Never trusted on read:
  -- a document written by a newer build is merged over the current defaults.
  preferences     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL
);

-- Sensitive preference changes are auditable. Kept separate from the current
-- document because "what is it now" and "who changed it when" answer different
-- questions, and squashing them means the second can never be asked.
CREATE TABLE IF NOT EXISTS user_preference_events (
  id           TEXT PRIMARY KEY,
  owner_scope  TEXT NOT NULL,
  changed_keys TEXT NOT NULL,
  created_at   BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_pref_events_owner
  ON user_preference_events (owner_scope, created_at DESC);

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences FORCE ROW LEVEL SECURITY;
ALTER TABLE user_preference_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preference_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_preferences_scope ON user_preferences;
CREATE POLICY user_preferences_scope ON user_preferences
  USING (owner_scope = migra_current_owner())
  WITH CHECK (owner_scope = migra_current_owner());

DROP POLICY IF EXISTS user_preference_events_scope ON user_preference_events;
CREATE POLICY user_preference_events_scope ON user_preference_events
  USING (owner_scope = migra_current_owner())
  WITH CHECK (owner_scope = migra_current_owner());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migrapilot_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON user_preferences TO migrapilot_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON user_preference_events TO migrapilot_app;
  END IF;
END $$;
`;

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'foundation', sql: M1_FOUNDATION },
  { version: 2, name: 'tenancy_primitives', sql: M2_TENANCY },
  { version: 3, name: 'conversations', sql: M3_CONVERSATIONS },
  { version: 4, name: 'app_role', sql: M4_APP_ROLE },
  { version: 5, name: 'memory_workspaces', sql: M5_MEMORY_WORKSPACES },
  { version: 6, name: 'rag', sql: M6_RAG },
  { version: 7, name: 'agent_runs', sql: M7_AGENT_RUNS },
  { version: 8, name: 'operational', sql: M8_OPERATIONAL },
  { version: 9, name: 'conversation_grounding', sql: M9_CONVERSATION_GROUNDING },
  { version: 10, name: 'parent_scope_integrity', sql: M10_PARENT_SCOPE_INTEGRITY },
  { version: 11, name: 'scoped_chunk_identity', sql: M11_SCOPED_CHUNK_IDENTITY },
  { version: 12, name: 'migration_runs', sql: M12_MIGRATION_RUNS },
  { version: 13, name: 'chunk_version_identity', sql: M13_CHUNK_VERSION_IDENTITY },
  { version: 14, name: 'anonymous_quota', sql: M14_ANONYMOUS_QUOTA },
  { version: 15, name: 'user_preferences', sql: M15_USER_PREFERENCES },
];

/** Highest version defined in code. */
export function latestVersion(): number {
  return MIGRATIONS.reduce((max, m) => (m.version > max ? m.version : max), 0);
}

/**
 * Target schema version for the PostgreSQL adapter.
 *
 * DERIVED, never hand-maintained — a hand-written constant drifts from the
 * migration list the first time someone appends a migration and forgets it.
 *
 * Deliberately independent of the SQLite adapter's `SCHEMA_VERSION` (7): the two
 * adapters evolve separately, and pinning them together would force a migration
 * in one because the other changed.
 */
export const PG_SCHEMA_VERSION = latestVersion();
