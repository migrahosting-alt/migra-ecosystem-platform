ALTER TABLE "public"."User"
  ADD COLUMN IF NOT EXISTS "authUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "emailNormalized" TEXT;

CREATE INDEX IF NOT EXISTS "User_authUserId_idx"
  ON "public"."User"("authUserId");

CREATE INDEX IF NOT EXISTS "User_emailNormalized_idx"
  ON "public"."User"("emailNormalized");
