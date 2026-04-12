-- ═══════════════════════════════════════════════════════════════════════
-- 002_hardening.sql  —  MigraAuth operational hardening
-- Partial indexes, expiry cleanup, passkey/WebAuthn prep, session limits
-- ═══════════════════════════════════════════════════════════════════════

-- ─── Partial index: active sessions only ────────────────────────────

CREATE INDEX idx_sessions_active_user
  ON sessions(user_id, created_at DESC)
  WHERE revoked_at IS NULL AND expires_at > now();

-- ─── Partial index: unexpired auth codes ────────────────────────────

CREATE INDEX idx_authcodes_active
  ON oauth_authorization_codes(code_hash)
  WHERE used_at IS NULL AND expires_at > now();

-- ─── Partial index: active refresh tokens ───────────────────────────

CREATE INDEX idx_refresh_tokens_active
  ON oauth_refresh_tokens(user_id, client_id)
  WHERE revoked_at IS NULL AND expires_at > now();

-- ─── Partial index: pending email verifications ─────────────────────

CREATE INDEX idx_email_verifications_pending
  ON email_verifications(user_id, token_hash)
  WHERE status = 'active' AND expires_at > now();

-- ─── Partial index: pending password resets ─────────────────────────

CREATE INDEX idx_password_resets_pending
  ON password_resets(user_id, token_hash)
  WHERE status = 'active' AND expires_at > now();

-- ─── Partial index: open MFA challenges ─────────────────────────────

CREATE INDEX idx_mfa_challenges_open
  ON mfa_challenges(user_id, method)
  WHERE verified_at IS NULL AND expires_at > now();

-- ─── Composite index: org membership lookups ────────────────────────

CREATE INDEX idx_org_members_user
  ON organization_members(user_id, status)
  WHERE status = 'active';

CREATE INDEX idx_org_members_org
  ON organization_members(organization_id, role, status)
  WHERE status = 'active';

-- ─── Audit: composite index for user-scoped timeline ────────────────

CREATE INDEX idx_audit_target_created
  ON audit_logs(target_user_id, created_at DESC)
  WHERE target_user_id IS NOT NULL;

-- ─── WebAuthn / Passkeys — future table skeleton ────────────────────

CREATE TABLE IF NOT EXISTS user_passkeys (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id   bytea       NOT NULL UNIQUE,
  public_key      bytea       NOT NULL,
  sign_count      bigint      NOT NULL DEFAULT 0,
  transports      text[]      NOT NULL DEFAULT '{}',
  device_name     varchar(160),
  is_enabled      boolean     NOT NULL DEFAULT true,
  last_used_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_passkeys_user ON user_passkeys(user_id) WHERE is_enabled = true;

-- ─── Organization invitation tokens ─────────────────────────────────

CREATE TABLE IF NOT EXISTS organization_invitations (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email           varchar(255) NOT NULL,
  role            member_role  NOT NULL DEFAULT 'member',
  token_hash      text         NOT NULL,
  invited_by      uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at      timestamptz  NOT NULL,
  accepted_at     timestamptz,
  created_at      timestamptz  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_org_invitations_active
  ON organization_invitations(organization_id, email)
  WHERE accepted_at IS NULL AND expires_at > now();

-- ─── Session concurrency limit function ─────────────────────────────
-- Enforces a maximum of N active sessions per user.
-- Called before inserting a new session.

CREATE OR REPLACE FUNCTION enforce_session_limit()
RETURNS TRIGGER AS $$
DECLARE
  max_sessions int := 10;
  active_count int;
BEGIN
  SELECT count(*) INTO active_count
    FROM sessions
   WHERE user_id    = NEW.user_id
     AND revoked_at IS NULL
     AND expires_at > now();

  IF active_count >= max_sessions THEN
    -- Revoke the oldest session to make room
    UPDATE sessions
       SET revoked_at = now()
     WHERE id = (
       SELECT id FROM sessions
        WHERE user_id    = NEW.user_id
          AND revoked_at IS NULL
          AND expires_at > now()
        ORDER BY created_at ASC
        LIMIT 1
     );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_session_limit
  BEFORE INSERT ON sessions
  FOR EACH ROW EXECUTE FUNCTION enforce_session_limit();

-- ─── Periodic cleanup: expired tokens & sessions ────────────────────
-- This is a helper function to be called by pg_cron or application-level scheduler.

CREATE OR REPLACE FUNCTION cleanup_expired_tokens()
RETURNS void AS $$
BEGIN
  -- Expired auth codes
  DELETE FROM oauth_authorization_codes
   WHERE expires_at < now() - interval '1 hour';

  -- Expired refresh tokens
  DELETE FROM oauth_refresh_tokens
   WHERE expires_at < now() - interval '7 days';

  -- Expired/revoked sessions
  DELETE FROM sessions
   WHERE (expires_at < now() - interval '7 days')
      OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '1 day');

  -- Expired email verifications
  UPDATE email_verifications SET status = 'expired'
   WHERE status = 'active' AND expires_at < now();

  -- Expired password resets
  UPDATE password_resets SET status = 'expired'
   WHERE status = 'active' AND expires_at < now();

  -- Expired MFA challenges
  DELETE FROM mfa_challenges
   WHERE expires_at < now() - interval '1 hour';

  -- Expired org invitations
  DELETE FROM organization_invitations
   WHERE expires_at < now() - interval '30 days'
     AND accepted_at IS NULL;
END;
$$ LANGUAGE plpgsql;

-- To schedule with pg_cron (requires extension):
-- SELECT cron.schedule('cleanup-expired-tokens', '0 */4 * * *', 'SELECT cleanup_expired_tokens()');
