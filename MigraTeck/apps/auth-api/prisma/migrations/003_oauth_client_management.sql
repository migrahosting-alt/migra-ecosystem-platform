-- ═══════════════════════════════════════════════════════════════════════
-- 003_oauth_client_management.sql  —  Developer-owned OAuth clients
-- Adds user/org ownership and metadata required for MigraAuth self-serve
-- client management.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE oauth_clients
  ADD COLUMN IF NOT EXISTS description varchar(500),
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS owner_organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_oauth_clients_owner_user
  ON oauth_clients(owner_user_id)
  WHERE owner_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_oauth_clients_owner_org
  ON oauth_clients(owner_organization_id)
  WHERE owner_organization_id IS NOT NULL;

ALTER TABLE oauth_clients
  DROP CONSTRAINT IF EXISTS oauth_clients_owner_scope_check;

ALTER TABLE oauth_clients
  ADD CONSTRAINT oauth_clients_owner_scope_check
  CHECK (
    is_first_party = true
    OR owner_user_id IS NOT NULL
    OR owner_organization_id IS NOT NULL
  );