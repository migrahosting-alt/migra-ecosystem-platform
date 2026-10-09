-- Align the root platform schema with the deployed BillingWebhookEvent ledger.
-- This migration is additive/idempotent so environments that already carry the
-- runtime columns remain unchanged.
ALTER TYPE "public"."BillingWebhookEventStatus" ADD VALUE IF NOT EXISTS 'QUEUED';
ALTER TYPE "public"."BillingWebhookEventStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';

ALTER TABLE "public"."BillingWebhookEvent"
  ADD COLUMN IF NOT EXISTS "apiVersion" TEXT,
  ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "errorText" TEXT,
  ADD COLUMN IF NOT EXISTS "firstProcessedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastProcessedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lockToken" TEXT,
  ADD COLUMN IF NOT EXISTS "lockedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "payloadJson" JSONB,
  ADD COLUMN IF NOT EXISTS "stripeAccountId" TEXT;
