ALTER TABLE "public"."MigraMarketMessagingDelivery"
ALTER COLUMN "campaignId" DROP NOT NULL,
ADD COLUMN "body" TEXT;

DROP INDEX "public"."MigraMarketMessagingDelivery_campaignId_phone_key";

CREATE INDEX "MigraMarketMessagingDelivery_orgId_direction_createdAt_idx"
ON "public"."MigraMarketMessagingDelivery"("orgId", "direction", "createdAt");