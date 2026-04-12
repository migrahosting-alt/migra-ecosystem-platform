ALTER TABLE "public"."PlatformConfig"
  ADD COLUMN "pauseProvisioningWorker" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "pauseEntitlementExpiryWorker" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "public"."BillingWebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

CREATE TABLE "public"."BillingWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" "public"."BillingProvider" NOT NULL DEFAULT 'STRIPE',
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventCreated" INTEGER,
    "livemode" BOOLEAN,
    "status" "public"."BillingWebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "reason" TEXT,
    "processedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BillingWebhookEvent_eventId_key" ON "public"."BillingWebhookEvent"("eventId");
CREATE INDEX "BillingWebhookEvent_provider_receivedAt_idx" ON "public"."BillingWebhookEvent"("provider", "receivedAt");
CREATE INDEX "BillingWebhookEvent_status_receivedAt_idx" ON "public"."BillingWebhookEvent"("status", "receivedAt");
