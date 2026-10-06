ALTER TABLE "UsageEvent"
  ADD COLUMN IF NOT EXISTS "meterName" TEXT,
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT,
  ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'api',
  ADD COLUMN IF NOT EXISTS "exportStatus" TEXT NOT NULL DEFAULT 'LOCAL_ONLY',
  ADD COLUMN IF NOT EXISTS "exportAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "nextRetryAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "exportedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "exportError" TEXT,
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS "UsageEvent_idempotencyKey_key"
  ON "UsageEvent" ("idempotencyKey");

CREATE INDEX IF NOT EXISTS "UsageEvent_orgId_meterName_timestamp_idx"
  ON "UsageEvent" ("orgId", "meterName", "timestamp");

CREATE INDEX IF NOT EXISTS "UsageEvent_exportStatus_nextRetryAt_idx"
  ON "UsageEvent" ("exportStatus", "nextRetryAt");
