-- ============================================================================
-- MigraPilot — ops action journal schema (Phase 11.2)
-- ============================================================================
-- Non-destructive. Idempotent (IF NOT EXISTS). NO DROP / NO TRUNCATE / no destructive ALTER.
--
-- WHAT THIS IS:
--   Optional Postgres backend for the controlled ops action journal. The DEFAULT journal is
--   in-memory (resets on restart); this schema is used only when
--   PILOT_OPS_ACTION_JOURNAL=postgres AND DATABASE_URL are set.
--
-- SECURITY:
--   `metadata` stores ONLY sanitized values (secret-looking keys are stripped by the app before
--   insert). No credentials/tokens are ever stored. This phase enables NO real mutation — records
--   are controlled no-op executions only.
--
-- HOW TO APPLY (manual only — the app never auto-migrates):
--   psql "$DATABASE_URL" -f migrations/0003_pilot_ops_action_journal.sql
--
-- HOW TO VERIFY:
--   psql "$DATABASE_URL" -c "\d pilot_ops_action_journal"
-- ============================================================================

CREATE TABLE IF NOT EXISTS pilot_ops_action_journal (
  id                   text PRIMARY KEY,
  action_name          text NOT NULL,
  category             text NOT NULL,
  execution_mode       text NOT NULL,
  target               text NOT NULL,
  reason               text,
  mutated              boolean NOT NULL DEFAULT false,
  dry_run              boolean NOT NULL DEFAULT false,
  executed             boolean NOT NULL DEFAULT false,
  -- recorded | verified | failed | cancelled | blocked
  status               text NOT NULL DEFAULT 'recorded',
  approval_id          text,
  run_id               text,
  metadata             jsonb,           -- sanitized values only (no secrets)
  summary              text,
  verification_summary text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pilot_ops_action_journal_created_idx ON pilot_ops_action_journal (created_at DESC);
CREATE INDEX IF NOT EXISTS pilot_ops_action_journal_action_idx  ON pilot_ops_action_journal (action_name);
