-- AlterTable
ALTER TABLE "public"."MigraMarketContentJob"
ADD COLUMN     "captionId" TEXT,
ADD COLUMN     "destinationUrl" TEXT,
ADD COLUMN     "publishLogs" JSONB,
ADD COLUMN     "selectedAssetId" TEXT,
ADD COLUMN     "useLinkPreview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "validationStatus" TEXT NOT NULL DEFAULT 'unvalidated';

-- AlterTable
ALTER TABLE "public"."MigraMarketContentTemplate"
ADD COLUMN     "ctaRequired" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "height" INTEGER,
ADD COLUMN     "logoRequired" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "maxBullets" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "maxHeadlineChars" INTEGER NOT NULL DEFAULT 40,
ADD COLUMN     "maxSubheadlineChars" INTEGER NOT NULL DEFAULT 80,
ADD COLUMN     "safeZones" JSONB,
ADD COLUMN     "styleFamily" TEXT,
ADD COLUMN     "templateKey" TEXT,
ADD COLUMN     "width" INTEGER;

-- AlterTable
ALTER TABLE "public"."MigraMarketCreativeBrief"
ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "approvedTemplateKeys" JSONB,
ADD COLUMN     "campaignKey" TEXT,
ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'brand',
ADD COLUMN     "disallowedAssetTags" JSONB,
ADD COLUMN     "headline" TEXT,
ADD COLUMN     "price" TEXT,
ADD COLUMN     "requireOgMatch" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "subheadline" TEXT,
ADD COLUMN     "visualFamily" TEXT;

-- CreateTable
CREATE TABLE "public"."MigraMarketContentAsset" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "assetKey" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "offer" TEXT,
    "styleFamily" TEXT,
    "platformTargets" JSONB,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "aspectRatio" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "previewUrl" TEXT,
    "landingPageIntent" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "qualityScore" DOUBLE PRECISION,
    "tags" JSONB,
    "campaignKeys" JSONB,
    "templateKey" TEXT,
    "blacklistForCampaigns" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MigraMarketContentAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MigraMarketContentCaption" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "briefId" TEXT NOT NULL,
    "captionKey" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "tone" TEXT NOT NULL DEFAULT 'premium_business',
    "body" TEXT NOT NULL,
    "cta" TEXT NOT NULL,
    "destinationUrl" TEXT NOT NULL,
    "useLinkPreview" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'approved',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MigraMarketContentCaption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MigraMarketOgSnapshot" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "url" TEXT NOT NULL,
    "ogTitle" TEXT,
    "ogDescription" TEXT,
    "ogImage" TEXT,
    "twitterTitle" TEXT,
    "twitterDescription" TEXT,
    "twitterImage" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MigraMarketOgSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MigraMarketPublishValidation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "briefId" TEXT,
    "assetId" TEXT,
    "captionId" TEXT,
    "platform" TEXT NOT NULL,
    "campaignMatch" BOOLEAN NOT NULL,
    "assetApproved" BOOLEAN NOT NULL,
    "platformValid" BOOLEAN NOT NULL,
    "dimensionsValid" BOOLEAN NOT NULL,
    "captionMatch" BOOLEAN NOT NULL,
    "ctaMatch" BOOLEAN NOT NULL,
    "landingPageMatch" BOOLEAN NOT NULL,
    "ogMatch" BOOLEAN NOT NULL,
    "assetBlacklisted" BOOLEAN NOT NULL,
    "brandLogoMatch" BOOLEAN NOT NULL,
    "qualityScore" DOUBLE PRECISION,
    "designQualityScore" DOUBLE PRECISION,
    "finalStatus" TEXT NOT NULL,
    "rawReport" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MigraMarketPublishValidation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MigraMarketContentAsset_orgId_status_createdAt_idx" ON "public"."MigraMarketContentAsset"("orgId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MigraMarketContentAsset_orgId_brand_category_createdAt_idx" ON "public"."MigraMarketContentAsset"("orgId", "brand", "category", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MigraMarketContentAsset_orgId_assetKey_key" ON "public"."MigraMarketContentAsset"("orgId", "assetKey");

-- CreateIndex
CREATE INDEX "MigraMarketContentCaption_orgId_briefId_platform_status_idx" ON "public"."MigraMarketContentCaption"("orgId", "briefId", "platform", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MigraMarketContentCaption_orgId_captionKey_key" ON "public"."MigraMarketContentCaption"("orgId", "captionKey");

-- CreateIndex
CREATE INDEX "MigraMarketOgSnapshot_url_fetchedAt_idx" ON "public"."MigraMarketOgSnapshot"("url", "fetchedAt");

-- CreateIndex
CREATE INDEX "MigraMarketOgSnapshot_orgId_fetchedAt_idx" ON "public"."MigraMarketOgSnapshot"("orgId", "fetchedAt");

-- CreateIndex
CREATE INDEX "MigraMarketPublishValidation_jobId_createdAt_idx" ON "public"."MigraMarketPublishValidation"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "MigraMarketPublishValidation_orgId_finalStatus_createdAt_idx" ON "public"."MigraMarketPublishValidation"("orgId", "finalStatus", "createdAt");

-- CreateIndex
CREATE INDEX "MigraMarketContentJob_orgId_validationStatus_createdAt_idx" ON "public"."MigraMarketContentJob"("orgId", "validationStatus", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MigraMarketContentTemplate_orgId_templateKey_key" ON "public"."MigraMarketContentTemplate"("orgId", "templateKey");

-- CreateIndex
CREATE INDEX "MigraMarketCreativeBrief_orgId_active_category_createdAt_idx" ON "public"."MigraMarketCreativeBrief"("orgId", "active", "category", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MigraMarketCreativeBrief_orgId_campaignKey_key" ON "public"."MigraMarketCreativeBrief"("orgId", "campaignKey");

-- AddForeignKey
ALTER TABLE "public"."MigraMarketContentJob"
ADD CONSTRAINT "MigraMarketContentJob_captionId_fkey" FOREIGN KEY ("captionId") REFERENCES "public"."MigraMarketContentCaption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MigraMarketContentJob"
ADD CONSTRAINT "MigraMarketContentJob_selectedAssetId_fkey" FOREIGN KEY ("selectedAssetId") REFERENCES "public"."MigraMarketContentAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MigraMarketContentAsset"
ADD CONSTRAINT "MigraMarketContentAsset_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MigraMarketContentCaption"
ADD CONSTRAINT "MigraMarketContentCaption_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MigraMarketContentCaption"
ADD CONSTRAINT "MigraMarketContentCaption_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "public"."MigraMarketCreativeBrief"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MigraMarketOgSnapshot"
ADD CONSTRAINT "MigraMarketOgSnapshot_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MigraMarketPublishValidation"
ADD CONSTRAINT "MigraMarketPublishValidation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MigraMarketPublishValidation"
ADD CONSTRAINT "MigraMarketPublishValidation_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "public"."MigraMarketContentJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MigraMarketPublishValidation"
ADD CONSTRAINT "MigraMarketPublishValidation_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "public"."MigraMarketCreativeBrief"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MigraMarketPublishValidation"
ADD CONSTRAINT "MigraMarketPublishValidation_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "public"."MigraMarketContentAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MigraMarketPublishValidation"
ADD CONSTRAINT "MigraMarketPublishValidation_captionId_fkey" FOREIGN KEY ("captionId") REFERENCES "public"."MigraMarketContentCaption"("id") ON DELETE SET NULL ON UPDATE CASCADE;
