-- ─────────────────────────────────────────────────────────────────────
-- MFA-pending sessions
--
-- WHY THIS COLUMN EXISTS. When MFA is enabled, both login paths issued a real
-- session cookie BEFORE asking for the second factor, and then told the client
-- to collect a code. That cookie was an ordinary session to every guard in the
-- service, so an unanswered challenge still authorised `/v1/me`,
-- `/v1/me/security` and even `/v1/admin/*`. Measured on production, not
-- theorised. The second factor gated a redirect, not the security boundary.
--
-- A session now carries the state of its own authentication. `mfa_pending_at`
-- set means "this browser has proved WHO it is and has not yet proved
-- PRESENCE" — enough to answer the challenge and nothing else.
--
-- NULLABLE, and null means fully authenticated. That direction matters: every
-- session that already exists reads as complete, so this migration cannot
-- retroactively lock anyone out of a session they legitimately hold.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS mfa_pending_at TIMESTAMPTZ NULL;

-- Partial index: the only queries that care are the ones looking for pending
-- sessions, which are rare and short-lived. A full index would be mostly nulls.
CREATE INDEX IF NOT EXISTS sessions_mfa_pending_idx
  ON sessions (user_id)
  WHERE mfa_pending_at IS NOT NULL;

COMMENT ON COLUMN sessions.mfa_pending_at IS
  'Set when the session was created before second-factor verification. Non-null sessions must NOT satisfy normal authenticated access — only the MFA challenge endpoints. Cleared on successful verification.';
