-- ============================================================================
-- MigraPilot — persistent approval store schema (Phase 9.9)
-- ============================================================================
-- Non-destructive. Idempotent (IF NOT EXISTS). NO DROP / NO TRUNCATE statements.
--
-- WHAT THIS IS:
--   Optional Postgres backend for MigraPilot action approvals. The DEFAULT store is
--   in-memory (resets on restart); this schema is used only when
--   PILOT_APPROVAL_STORE=postgres AND DATABASE_URL are set.
--
-- PREREQUISITES:
--   - PostgreSQL 13+.
--   - The `pg` npm package installed in the app (npm install pg) for runtime use.
--
-- SECURITY:
--   - `args` stores ONLY sanitized arguments (secret-looking keys are stripped by the
--     app before insert). Do not relax that in the app layer.
--
-- HOW TO APPLY (manual only — the app never auto-migrates):
--   psql "$DATABASE_URL" -f migrations/0002_pilot_approvals.sql
--
-- HOW TO VERIFY:
--   psql "$DATABASE_URL" -c "\d pilot_approvals"
-- ============================================================================

CREATE TABLE IF NOT EXISTS pilot_approvals (
  id              text PRIMARY KEY,
  run_id          text NOT NULL,
  step_id         text,
  tool_name       text NOT NULL,
  args            jsonb NOT NULL DEFAULT '{}'::jsonb,  -- sanitized args only (no secrets)
  args_digest     text,
  risk            text NOT NULL,
  reason          text,
  summary         text,
  expected_effect text,
  -- pending | approved | cancelled | executed | expired | blocked
  status          text NOT NULL DEFAULT 'pending',
  detail          text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz,
  executed_at     timestamptz
);

CREATE INDEX IF NOT EXISTS pilot_approvals_run_idx     ON pilot_approvals (run_id);
CREATE INDEX IF NOT EXISTS pilot_approvals_status_idx  ON pilot_approvals (status);
CREATE INDEX IF NOT EXISTS pilot_approvals_created_idx ON pilot_approvals (created_at DESC);
