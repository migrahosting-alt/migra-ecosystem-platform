ALTER TABLE "public"."MigraMarketAccount"
ADD COLUMN "packageTemplateId" TEXT;

CREATE TABLE "public"."MigraMarketPackageTemplate" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'managed_service',
    "monthlyPrice" DOUBLE PRECISION,
    "setupPrice" DOUBLE PRECISION,
    "serviceBundle" JSONB,
    "defaultTasks" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MigraMarketPackageTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."MigraMarketLeadCaptureForm" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sourceChannel" TEXT NOT NULL DEFAULT 'website',
    "destinationEmail" TEXT,
    "thankYouMessage" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MigraMarketLeadCaptureForm_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."MigraMarketLeadRecord" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "formId" TEXT,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "company" TEXT,
    "sourceChannel" TEXT NOT NULL DEFAULT 'website',
    "campaign" TEXT,
    "landingPage" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "valueEstimate" DOUBLE PRECISION,
    "notes" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MigraMarketLeadRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MigraMarketPackageTemplate_code_key" ON "public"."MigraMarketPackageTemplate"("code");
CREATE UNIQUE INDEX "MigraMarketLeadCaptureForm_orgId_slug_key" ON "public"."MigraMarketLeadCaptureForm"("orgId", "slug");
CREATE INDEX "MigraMarketLeadCaptureForm_orgId_active_createdAt_idx" ON "public"."MigraMarketLeadCaptureForm"("orgId", "active", "createdAt");
CREATE INDEX "MigraMarketLeadRecord_orgId_status_createdAt_idx" ON "public"."MigraMarketLeadRecord"("orgId", "status", "createdAt");
CREATE INDEX "MigraMarketLeadRecord_orgId_sourceChannel_createdAt_idx" ON "public"."MigraMarketLeadRecord"("orgId", "sourceChannel", "createdAt");

ALTER TABLE "public"."MigraMarketAccount"
ADD CONSTRAINT "MigraMarketAccount_packageTemplateId_fkey"
FOREIGN KEY ("packageTemplateId") REFERENCES "public"."MigraMarketPackageTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "public"."MigraMarketLeadCaptureForm"
ADD CONSTRAINT "MigraMarketLeadCaptureForm_orgId_fkey"
FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."MigraMarketLeadRecord"
ADD CONSTRAINT "MigraMarketLeadRecord_orgId_fkey"
FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."MigraMarketLeadRecord"
ADD CONSTRAINT "MigraMarketLeadRecord_formId_fkey"
FOREIGN KEY ("formId") REFERENCES "public"."MigraMarketLeadCaptureForm"("id") ON DELETE SET NULL ON UPDATE CASCADE;
