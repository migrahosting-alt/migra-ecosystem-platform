-- 007 — bind OAuth tokens to a single active organization
--
-- A membership array in a token does not say which tenant is authoritative for the request
-- carrying it. These columns let one organization be selected at authorization, recorded
-- against the authorization code, and preserved through exchange and refresh, so the
-- choice cannot be substituted later by browser input.
--
-- SAFETY. Purely additive: three ADD COLUMN statements, no drops, no rewrites, no
-- backfill. Existing rows keep working unchanged —
--
--   * `requires_active_organization` is NOT NULL DEFAULT false, so every existing client
--     (migrateck_web, migrahosting_web, migradrive_web, migramail_web, migrapanel_web,
--     migravoice_web) migrates to "not organization-bound" and behaves exactly as before.
--     Organization binding is opt-in per client, never switched on for everyone at once.
--   * both `organization_id` columns are NULLABLE, so codes and refresh tokens issued
--     before this migration remain valid with no organization context invented for them.
--
-- NO FOREIGN KEY, deliberately. A reference to `organizations(id)` would need a delete
-- rule, and every option is wrong here: CASCADE would destroy authorization and refresh
-- records — which are audit-relevant — when an organization is removed, and RESTRICT
-- would make deleting an organization fail on rows that are merely historical. The column
-- records WHICH organization was bound at the time; whether that membership is still
-- usable is revalidated at every exchange and refresh, which is the check that actually
-- matters. A stale id therefore fails closed at use rather than corrupting deletion.
--
-- ROLLBACK. Drop the three columns; nothing else is touched and no data is lost that did
-- not originate with this feature:
--
--   ALTER TABLE "oauth_refresh_tokens"       DROP COLUMN "organization_id";
--   ALTER TABLE "oauth_authorization_codes"  DROP COLUMN "organization_id";
--   ALTER TABLE "oauth_clients"              DROP COLUMN "requires_active_organization";
--
-- The MigraPilot consumer client is deliberately NOT seeded here: its redirect URIs and
-- deployment values are not settled, and registering a client in the same change that adds
-- the capability would put an unusable row in production.

-- AlterTable
ALTER TABLE "oauth_clients" ADD COLUMN "requires_active_organization" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "oauth_authorization_codes" ADD COLUMN "organization_id" UUID;

-- AlterTable
ALTER TABLE "oauth_refresh_tokens" ADD COLUMN "organization_id" UUID;
