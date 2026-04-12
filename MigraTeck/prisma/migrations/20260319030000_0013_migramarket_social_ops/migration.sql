-- CreateTable
CREATE TABLE "public"."MigraMarketSocialConnection" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "profileType" TEXT NOT NULL DEFAULT 'business',
    "profileUrl" TEXT,
    "publishMode" TEXT NOT NULL DEFAULT 'assisted',
    "accessModel" TEXT NOT NULL DEFAULT 'profile_access',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "externalAccountId" TEXT,
    "scopes" JSONB,
    "metadata" JSONB,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MigraMarketSocialConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MigraMarketCreativeBrief" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT NOT NULL DEFAULT 'MigraHosting',
    "product" TEXT,
    "audience" TEXT,
    "objective" TEXT NOT NULL DEFAULT 'awareness',
    "offer" TEXT,
    "cta" TEXT,
    "landingPage" TEXT,
    "channels" JSONB,
    "visualStyle" TEXT,
    "diversityNotes" TEXT,
    "brandSignature" TEXT DEFAULT 'Powered by MigraTeck',
    "promptNotes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MigraMarketCreativeBrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MigraMarketContentJob" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "briefId" TEXT,
    "connectionId" TEXT,
    "title" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'post',
    "publishMode" TEXT NOT NULL DEFAULT 'assisted',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "scheduledAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "caption" TEXT,
    "assetUrls" JSONB,
    "thumbnailUrl" TEXT,
    "aiPrompt" TEXT,
    "internalNotes" TEXT,
    "complianceNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MigraMarketContentJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MigraMarketSocialConnection_orgId_platform_handle_key" ON "public"."MigraMarketSocialConnection"("orgId", "platform", "handle");

-- CreateIndex
CREATE INDEX "MigraMarketSocialConnection_orgId_status_platform_idx" ON "public"."MigraMarketSocialConnection"("orgId", "status", "platform");

-- CreateIndex
CREATE INDEX "MigraMarketCreativeBrief_orgId_status_createdAt_idx" ON "public"."MigraMarketCreativeBrief"("orgId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MigraMarketContentJob_orgId_status_scheduledAt_idx" ON "public"."MigraMarketContentJob"("orgId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "MigraMarketContentJob_orgId_platform_createdAt_idx" ON "public"."MigraMarketContentJob"("orgId", "platform", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."MigraMarketSocialConnection"
ADD CONSTRAINT "MigraMarketSocialConnection_orgId_fkey"
FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MigraMarketCreativeBrief"
ADD CONSTRAINT "MigraMarketCreativeBrief_orgId_fkey"
FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MigraMarketContentJob"
ADD CONSTRAINT "MigraMarketContentJob_orgId_fkey"
FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MigraMarketContentJob"
ADD CONSTRAINT "MigraMarketContentJob_briefId_fkey"
FOREIGN KEY ("briefId") REFERENCES "public"."MigraMarketCreativeBrief"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MigraMarketContentJob"
ADD CONSTRAINT "MigraMarketContentJob_connectionId_fkey"
FOREIGN KEY ("connectionId") REFERENCES "public"."MigraMarketSocialConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
