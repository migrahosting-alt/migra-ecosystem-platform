ALTER TABLE "public"."MigraMarketAccount"
ADD COLUMN "messagingBrandName" TEXT,
ADD COLUMN "messagingFromNumber" TEXT,
ADD COLUMN "messagingSupportEmail" TEXT;

ALTER TABLE "public"."MigraMarketLeadCaptureForm"
ADD COLUMN "smsConsentEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "smsConsentLabel" TEXT;

ALTER TABLE "public"."MigraMarketLeadRecord"
ADD COLUMN "smsConsentStatus" TEXT NOT NULL DEFAULT 'unknown',
ADD COLUMN "smsConsentAt" TIMESTAMP(3),
ADD COLUMN "smsConsentSource" TEXT,
ADD COLUMN "smsConsentEvidence" TEXT,
ADD COLUMN "smsOptedOutAt" TIMESTAMP(3),
ADD COLUMN "messagingTags" JSONB;

CREATE TABLE "public"."MigraMarketMessagingCampaign" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'sms',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "fromNumber" TEXT NOT NULL,
    "audienceTag" TEXT,
    "body" TEXT NOT NULL,
    "mediaUrls" JSONB,
    "scheduledAt" TIMESTAMP(3),
    "launchedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastDispatchedAt" TIMESTAMP(3),
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "queuedCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "deliveredCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MigraMarketMessagingCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."MigraMarketMessagingDelivery" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "leadId" TEXT,
    "phone" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'telnyx',
    "direction" TEXT NOT NULL DEFAULT 'outbound',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "externalMessageId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "costAmount" DOUBLE PRECISION,
    "deliveredAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MigraMarketMessagingDelivery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."MigraMarketMessagingWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'telnyx',
    "orgId" TEXT,
    "externalEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "payload" JSONB,
    "processedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MigraMarketMessagingWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MigraMarketMessagingDelivery_externalMessageId_key" ON "public"."MigraMarketMessagingDelivery"("externalMessageId");
CREATE UNIQUE INDEX "MigraMarketMessagingDelivery_campaignId_phone_key" ON "public"."MigraMarketMessagingDelivery"("campaignId", "phone");
CREATE UNIQUE INDEX "MigraMarketMessagingWebhookEvent_externalEventId_key" ON "public"."MigraMarketMessagingWebhookEvent"("externalEventId");

CREATE INDEX "MigraMarketMessagingCampaign_orgId_status_createdAt_idx" ON "public"."MigraMarketMessagingCampaign"("orgId", "status", "createdAt");
CREATE INDEX "MigraMarketMessagingCampaign_orgId_scheduledAt_createdAt_idx" ON "public"."MigraMarketMessagingCampaign"("orgId", "scheduledAt", "createdAt");
CREATE INDEX "MigraMarketMessagingDelivery_orgId_status_createdAt_idx" ON "public"."MigraMarketMessagingDelivery"("orgId", "status", "createdAt");
CREATE INDEX "MigraMarketMessagingDelivery_campaignId_status_createdAt_idx" ON "public"."MigraMarketMessagingDelivery"("campaignId", "status", "createdAt");
CREATE INDEX "MigraMarketMessagingDelivery_leadId_createdAt_idx" ON "public"."MigraMarketMessagingDelivery"("leadId", "createdAt");
CREATE INDEX "MigraMarketMessagingWebhookEvent_provider_receivedAt_idx" ON "public"."MigraMarketMessagingWebhookEvent"("provider", "receivedAt");
CREATE INDEX "MigraMarketMessagingWebhookEvent_status_receivedAt_idx" ON "public"."MigraMarketMessagingWebhookEvent"("status", "receivedAt");

ALTER TABLE "public"."MigraMarketMessagingCampaign"
ADD CONSTRAINT "MigraMarketMessagingCampaign_orgId_fkey"
FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."MigraMarketMessagingDelivery"
ADD CONSTRAINT "MigraMarketMessagingDelivery_orgId_fkey"
FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."MigraMarketMessagingDelivery"
ADD CONSTRAINT "MigraMarketMessagingDelivery_campaignId_fkey"
FOREIGN KEY ("campaignId") REFERENCES "public"."MigraMarketMessagingCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."MigraMarketMessagingDelivery"
ADD CONSTRAINT "MigraMarketMessagingDelivery_leadId_fkey"
FOREIGN KEY ("leadId") REFERENCES "public"."MigraMarketLeadRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "public"."MigraMarketMessagingWebhookEvent"
ADD CONSTRAINT "MigraMarketMessagingWebhookEvent_orgId_fkey"
FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
