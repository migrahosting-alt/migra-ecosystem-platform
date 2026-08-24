-- ─────────────────────────────────────────────────────────────────────
-- Platform operator roles
--
-- WHAT THIS REPLACES. `/v1/admin/*` was authorized by `AUTH_ADMIN_USER_IDS`, a
-- comma-separated env allowlist. That was written deliberately as a stopgap to
-- close a live hole — the surface had been guarded by "is signed in", so any
-- consumer could enumerate users, read the audit log and disable any account —
-- and its own comment says a role belongs in the schema. This is that schema.
--
-- WHY AN ENV VAR IS THE WRONG HOME. It cannot record WHO granted access or WHEN,
-- cannot be revoked without a deploy, is invisible to any interface, and is
-- edited by whoever can edit a unit file. Operator access over every account in
-- the platform should be a fact in the database with an author and a timestamp.
--
-- GRANTS ARE APPEND-ONLY IN SPIRIT: revoking sets `revoked_at` rather than
-- deleting the row, so "who could do this on the day it happened" stays
-- answerable after the fact. A deleted row cannot answer that.
--
-- ROLES BUNDLE PERMISSIONS; PERMISSIONS ARE THE PRIMITIVE. The role names live
-- here, but what each one may DO is defined in code (`modules/authorization/
-- platformRoles.ts`) as an explicit permission set. Re-cutting the bundles later
-- is then a code change with tests, not a data migration over live grants.
--
-- NULLABLE `granted_by_user_id`: the first grant on a fresh deployment has no
-- granter, and a NOT NULL here would make bootstrapping impossible.
-- ─────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE platform_role AS ENUM ('support', 'operator', 'owner');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS platform_role_grants (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role               platform_role NOT NULL,
  granted_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  granted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at         TIMESTAMPTZ NULL,
  revoked_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  note               VARCHAR(300) NULL
);

-- One LIVE grant of a role per user. Partial, so the historical rows a
-- revocation leaves behind never collide with a later re-grant of the same role.
CREATE UNIQUE INDEX IF NOT EXISTS platform_role_grants_live_idx
  ON platform_role_grants (user_id, role)
  WHERE revoked_at IS NULL;

-- The hot path is "what may this user do", evaluated on every admin request.
CREATE INDEX IF NOT EXISTS platform_role_grants_user_live_idx
  ON platform_role_grants (user_id)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE platform_role_grants IS
  'Platform-wide operator roles. Replaces the AUTH_ADMIN_USER_IDS env allowlist. Revocation sets revoked_at rather than deleting, so historical authority stays auditable.';
COMMENT ON COLUMN platform_role_grants.granted_by_user_id IS
  'Who granted it. NULL only for a bootstrap grant, which has no granter by definition.';
