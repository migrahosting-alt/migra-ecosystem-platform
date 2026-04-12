-- Add index to support user-scoped session pruning/revocation queries.
CREATE INDEX IF NOT EXISTS "Session_userId_expires_idx" ON "public"."Session"("userId", "expires");
