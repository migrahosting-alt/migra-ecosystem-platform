DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'DriveTenantStatus'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE "public"."DriveTenantStatus" AS ENUM ('PENDING', 'ACTIVE', 'RESTRICTED', 'DISABLED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'ProvisioningAction' AND e.enumlabel = 'DRIVE_PROVISION'
  ) THEN
    ALTER TYPE "public"."ProvisioningAction" ADD VALUE 'DRIVE_PROVISION';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'ProvisioningAction' AND e.enumlabel = 'DRIVE_DISABLE'
  ) THEN
    ALTER TYPE "public"."ProvisioningAction" ADD VALUE 'DRIVE_DISABLE';
  END IF;
END $$;

CREATE TABLE "DriveTenant" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "orgSlug" TEXT NOT NULL,
  "status" "public"."DriveTenantStatus" NOT NULL DEFAULT 'PENDING',
  "planCode" TEXT NOT NULL,
  "storageQuotaGb" INTEGER NOT NULL,
  "storageUsedBytes" BIGINT NOT NULL DEFAULT 0,
  "subscriptionId" TEXT,
  "entitlementId" TEXT,
  "externalRef" TEXT,
  "provisioningJobId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "activatedAt" TIMESTAMP(3),
  "restrictedAt" TIMESTAMP(3),
  "disabledAt" TIMESTAMP(3),
  "disableReason" TEXT,
  "restrictionReason" TEXT,

  CONSTRAINT "DriveTenant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DriveTenantEvent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "previousStatus" "public"."DriveTenantStatus",
  "newStatus" "public"."DriveTenantStatus",
  "previousPlanCode" TEXT,
  "newPlanCode" TEXT,
  "previousQuotaGb" INTEGER,
  "newQuotaGb" INTEGER,
  "subscriptionId" TEXT,
  "entitlementId" TEXT,
  "idempotencyKey" TEXT,
  "traceId" TEXT,
  "actorType" TEXT NOT NULL,
  "actorId" TEXT,
  "metadataJson" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DriveTenantEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DriveTenantOperation" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT,
  "orgId" TEXT NOT NULL,
  "operationType" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "requestJson" TEXT,
  "responseJson" TEXT,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "idempotencyKey" TEXT,
  "traceId" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),

  CONSTRAINT "DriveTenantOperation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DriveTenant_orgId_key" ON "DriveTenant"("orgId");
CREATE UNIQUE INDEX "DriveTenant_orgSlug_key" ON "DriveTenant"("orgSlug");
CREATE INDEX "DriveTenant_status_idx" ON "DriveTenant"("status");
CREATE INDEX "DriveTenant_subscriptionId_idx" ON "DriveTenant"("subscriptionId");
CREATE INDEX "DriveTenant_entitlementId_idx" ON "DriveTenant"("entitlementId");

CREATE INDEX "DriveTenantEvent_tenantId_createdAt_idx" ON "DriveTenantEvent"("tenantId", "createdAt");
CREATE INDEX "DriveTenantEvent_orgId_createdAt_idx" ON "DriveTenantEvent"("orgId", "createdAt");
CREATE INDEX "DriveTenantEvent_action_createdAt_idx" ON "DriveTenantEvent"("action", "createdAt");
CREATE INDEX "DriveTenantEvent_idempotencyKey_idx" ON "DriveTenantEvent"("idempotencyKey");

CREATE INDEX "DriveTenantOperation_orgId_startedAt_idx" ON "DriveTenantOperation"("orgId", "startedAt");
CREATE INDEX "DriveTenantOperation_tenantId_startedAt_idx" ON "DriveTenantOperation"("tenantId", "startedAt");
CREATE INDEX "DriveTenantOperation_operationType_startedAt_idx" ON "DriveTenantOperation"("operationType", "startedAt");

ALTER TABLE "DriveTenant"
  ADD CONSTRAINT "DriveTenant_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DriveTenantEvent"
  ADD CONSTRAINT "DriveTenantEvent_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "DriveTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;