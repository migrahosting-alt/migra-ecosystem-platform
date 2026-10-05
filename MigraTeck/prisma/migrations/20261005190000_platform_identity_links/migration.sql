-- MigraTeck Platform identity bridge.
-- MigraAuth remains authoritative; these columns only link platform rows to
-- canonical MigraAuth users and organizations.

ALTER TABLE "public"."User"
  ADD COLUMN IF NOT EXISTS "authUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "emailNormalized" TEXT;

ALTER TABLE "public"."Organization"
  ADD COLUMN IF NOT EXISTS "authOrganizationId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "User_authUserId_key"
  ON "public"."User"("authUserId")
  WHERE "authUserId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "User_emailNormalized_idx"
  ON "public"."User"("emailNormalized");

CREATE UNIQUE INDEX IF NOT EXISTS "Organization_authOrganizationId_key"
  ON "public"."Organization"("authOrganizationId")
  WHERE "authOrganizationId" IS NOT NULL;
