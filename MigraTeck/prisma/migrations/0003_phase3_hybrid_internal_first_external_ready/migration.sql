-- CreateEnum
CREATE TYPE "public"."AccessRequestStatus" AS ENUM ('OPEN', 'TRIAGED', 'APPROVED', 'DENIED');

-- CreateEnum replacement for expanded entitlement states.
CREATE TYPE "public"."EntitlementStatus_new" AS ENUM ('ACTIVE', 'TRIAL', 'RESTRICTED', 'INTERNAL_ONLY');

-- AlterTable
ALTER TABLE "public"."OrgEntitlement"
  ADD COLUMN "startsAt" TIMESTAMP(3),
  ADD COLUMN "endsAt" TIMESTAMP(3),
  ADD COLUMN "notes" TEXT;

ALTER TABLE "public"."OrgEntitlement" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "public"."OrgEntitlement"
  ALTER COLUMN "status" TYPE "public"."EntitlementStatus_new"
  USING (
    CASE
      WHEN "status"::text = 'ACTIVE' THEN 'ACTIVE'::"public"."EntitlementStatus_new"
      WHEN "status"::text = 'PENDING' THEN 'RESTRICTED'::"public"."EntitlementStatus_new"
      WHEN "status"::text = 'REVOKED' THEN 'RESTRICTED'::"public"."EntitlementStatus_new"
      ELSE 'RESTRICTED'::"public"."EntitlementStatus_new"
    END
  );

ALTER TABLE "public"."OrgEntitlement" ALTER COLUMN "status" SET DEFAULT 'RESTRICTED';

DROP TYPE "public"."EntitlementStatus";
ALTER TYPE "public"."EntitlementStatus_new" RENAME TO "EntitlementStatus";

-- CreateTable
CREATE TABLE "public"."PlatformConfig" (
    "id" TEXT NOT NULL,
    "allowPublicSignup" BOOLEAN NOT NULL DEFAULT false,
    "allowOrgCreate" BOOLEAN NOT NULL DEFAULT false,
    "waitlistMode" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OrgInvitation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "public"."OrgRole" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AccessRequest" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "product" "public"."ProductKey" NOT NULL,
    "message" TEXT,
    "status" "public"."AccessRequestStatus" NOT NULL DEFAULT 'OPEN',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DownloadArtifact" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "product" "public"."ProductKey" NOT NULL,
    "version" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DownloadArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrgInvitation_tokenHash_key" ON "public"."OrgInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "OrgInvitation_orgId_idx" ON "public"."OrgInvitation"("orgId");

-- CreateIndex
CREATE INDEX "OrgInvitation_email_idx" ON "public"."OrgInvitation"("email");

-- CreateIndex
CREATE INDEX "OrgInvitation_expiresAt_idx" ON "public"."OrgInvitation"("expiresAt");

-- CreateIndex
CREATE INDEX "AccessRequest_orgId_status_idx" ON "public"."AccessRequest"("orgId", "status");

-- CreateIndex
CREATE INDEX "AccessRequest_product_status_idx" ON "public"."AccessRequest"("product", "status");

-- CreateIndex
CREATE INDEX "DownloadArtifact_product_isActive_idx" ON "public"."DownloadArtifact"("product", "isActive");

-- CreateIndex
CREATE INDEX "DownloadArtifact_createdAt_idx" ON "public"."DownloadArtifact"("createdAt");

-- AddForeignKey
ALTER TABLE "public"."OrgInvitation" ADD CONSTRAINT "OrgInvitation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrgInvitation" ADD CONSTRAINT "OrgInvitation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AccessRequest" ADD CONSTRAINT "AccessRequest_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AccessRequest" ADD CONSTRAINT "AccessRequest_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
