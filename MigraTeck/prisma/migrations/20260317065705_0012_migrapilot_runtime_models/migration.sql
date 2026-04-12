-- CreateEnum
CREATE TYPE "public"."PilotRunStatus" AS ENUM ('REQUESTED', 'VALIDATING', 'PLANNED', 'AWAITING_APPROVAL', 'EXECUTING', 'VERIFYING', 'COMPLETED', 'FAILED', 'ROLLED_BACK', 'CANCELED');

-- CreateEnum
CREATE TYPE "public"."PilotRunStepStatus" AS ENUM ('PENDING', 'READY', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "public"."PilotVerificationState" AS ENUM ('NOT_REQUIRED', 'PENDING', 'PASSED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."PilotRollbackState" AS ENUM ('NOT_REQUIRED', 'AVAILABLE', 'STARTED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."PilotApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'EXPIRED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "public"."PilotPolicyDecisionResult" AS ENUM ('ALLOW', 'BLOCK', 'REQUIRE_APPROVAL', 'ESCALATE');

-- CreateEnum
CREATE TYPE "public"."PilotArtifactRedactionState" AS ENUM ('RAW', 'SANITIZED', 'REDACTED');

-- CreateEnum
CREATE TYPE "public"."ResourceNodeType" AS ENUM ('TENANT', 'PRODUCT', 'DOMAIN', 'DNS_ZONE', 'ROUTE', 'CERTIFICATE', 'SERVICE', 'INFRASTRUCTURE_NODE', 'MAILBOX', 'STORAGE_BUCKET', 'PHONE_NUMBER', 'HOSTING_SITE', 'DEPLOYMENT_RELEASE', 'INCIDENT', 'BILLING_ACCOUNT', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."ResourceRelationshipType" AS ENUM ('OWNS', 'BELONGS_TO', 'USES', 'RUNS_ON', 'EXPOSES', 'ROUTES_TO', 'DEPENDS_ON', 'PROTECTS', 'BILLED_TO', 'AFFECTED_BY', 'MANAGED_BY', 'VERIFIED_BY');

-- CreateEnum
CREATE TYPE "public"."ServiceHealthState" AS ENUM ('UNKNOWN', 'HEALTHY', 'DEGRADED', 'UNHEALTHY');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'ProductKey' AND e.enumlabel = 'MIGRATECK'
  ) THEN
    ALTER TYPE "public"."ProductKey" ADD VALUE 'MIGRATECK';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'ProductKey' AND e.enumlabel = 'MIGRAHOSTING'
  ) THEN
    ALTER TYPE "public"."ProductKey" ADD VALUE 'MIGRAHOSTING';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'ProductKey' AND e.enumlabel = 'MIGRAMAIL'
  ) THEN
    ALTER TYPE "public"."ProductKey" ADD VALUE 'MIGRAMAIL';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'ProductKey' AND e.enumlabel = 'MIGRAINTAKE'
  ) THEN
    ALTER TYPE "public"."ProductKey" ADD VALUE 'MIGRAINTAKE';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'ProductKey' AND e.enumlabel = 'MIGRAMARKET'
  ) THEN
    ALTER TYPE "public"."ProductKey" ADD VALUE 'MIGRAMARKET';
  END IF;
END
$$;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'ProvisioningAction' AND e.enumlabel = 'ACCESS_GRANT'
  ) THEN
    ALTER TYPE "public"."ProvisioningAction" ADD VALUE 'ACCESS_GRANT';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'ProvisioningAction' AND e.enumlabel = 'ACCESS_RESTRICT'
  ) THEN
    ALTER TYPE "public"."ProvisioningAction" ADD VALUE 'ACCESS_RESTRICT';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'ProvisioningAction' AND e.enumlabel = 'VOICE_PROVISION'
  ) THEN
    ALTER TYPE "public"."ProvisioningAction" ADD VALUE 'VOICE_PROVISION';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'ProvisioningAction' AND e.enumlabel = 'VOICE_DISABLE'
  ) THEN
    ALTER TYPE "public"."ProvisioningAction" ADD VALUE 'VOICE_DISABLE';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'ProvisioningAction' AND e.enumlabel = 'MAIL_PROVISION'
  ) THEN
    ALTER TYPE "public"."ProvisioningAction" ADD VALUE 'MAIL_PROVISION';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'ProvisioningAction' AND e.enumlabel = 'INTAKE_PROVISION'
  ) THEN
    ALTER TYPE "public"."ProvisioningAction" ADD VALUE 'INTAKE_PROVISION';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'ProvisioningAction' AND e.enumlabel = 'MARKET_PROVISION'
  ) THEN
    ALTER TYPE "public"."ProvisioningAction" ADD VALUE 'MARKET_PROVISION';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'ProvisioningAction' AND e.enumlabel = 'PILOT_PROVISION'
  ) THEN
    ALTER TYPE "public"."ProvisioningAction" ADD VALUE 'PILOT_PROVISION';
  END IF;
END
$$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."RevenueOnboardingContact" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'migra-market',
    "company" TEXT NOT NULL,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "plan" TEXT NOT NULL,
    "requestedProduct" "public"."ProductKey" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "revenueCustomerId" TEXT,
    "tenantId" TEXT,
    "monthlyRevenue" DOUBLE PRECISION,
    "notes" TEXT,
    "operatorEmailSent" BOOLEAN NOT NULL DEFAULT false,
    "contactEmailSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RevenueOnboardingContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PilotRun" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "actorUserId" TEXT,
    "delegatedByPrincipalId" TEXT,
    "orgId" TEXT,
    "environment" TEXT NOT NULL DEFAULT 'dev',
    "intent" TEXT NOT NULL,
    "commandName" TEXT,
    "riskTier" INTEGER NOT NULL DEFAULT 1,
    "status" "public"."PilotRunStatus" NOT NULL DEFAULT 'REQUESTED',
    "verificationState" "public"."PilotVerificationState" NOT NULL DEFAULT 'PENDING',
    "rollbackState" "public"."PilotRollbackState" NOT NULL DEFAULT 'NOT_REQUIRED',
    "correlationId" TEXT,
    "summary" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PilotRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PilotRunStep" (
    "id" TEXT NOT NULL,
    "pilotRunId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "stepType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "public"."PilotRunStepStatus" NOT NULL DEFAULT 'PENDING',
    "targetType" TEXT,
    "targetId" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "rollbackStep" BOOLEAN NOT NULL DEFAULT false,
    "verificationRequired" BOOLEAN NOT NULL DEFAULT true,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PilotRunStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PilotEvent" (
    "id" TEXT NOT NULL,
    "pilotRunId" TEXT NOT NULL,
    "pilotRunStepId" TEXT,
    "eventType" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "severity" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PilotEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PilotPolicyDecision" (
    "id" TEXT NOT NULL,
    "pilotRunId" TEXT NOT NULL,
    "policyName" TEXT NOT NULL,
    "decision" "public"."PilotPolicyDecisionResult" NOT NULL,
    "reason" TEXT,
    "riskTier" INTEGER NOT NULL DEFAULT 1,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PilotPolicyDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PilotApproval" (
    "id" TEXT NOT NULL,
    "pilotRunId" TEXT NOT NULL,
    "approvalType" TEXT NOT NULL,
    "status" "public"."PilotApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requestedByUserId" TEXT,
    "approverUserId" TEXT,
    "reason" TEXT,
    "riskSummary" TEXT,
    "blastRadiusSummary" TEXT,
    "rollbackPlanSummary" TEXT,
    "verificationPlanSummary" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "PilotApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PilotArtifact" (
    "id" TEXT NOT NULL,
    "pilotRunId" TEXT NOT NULL,
    "pilotRunStepId" TEXT,
    "artifactType" TEXT NOT NULL,
    "storageUri" TEXT NOT NULL,
    "contentType" TEXT,
    "checksum" TEXT,
    "redactionState" "public"."PilotArtifactRedactionState" NOT NULL DEFAULT 'SANITIZED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PilotArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PilotExecutionLock" (
    "id" TEXT NOT NULL,
    "lockKey" TEXT NOT NULL,
    "lockScope" TEXT NOT NULL,
    "orgId" TEXT,
    "targetType" TEXT,
    "targetId" TEXT,
    "pilotRunId" TEXT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "PilotExecutionLock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PilotIncidentLink" (
    "id" TEXT NOT NULL,
    "pilotRunId" TEXT NOT NULL,
    "incidentRef" TEXT NOT NULL,
    "linkType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PilotIncidentLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ResourceNode" (
    "id" TEXT NOT NULL,
    "nodeType" "public"."ResourceNodeType" NOT NULL,
    "externalId" TEXT,
    "displayName" TEXT NOT NULL,
    "orgId" TEXT,
    "product" "public"."ProductKey",
    "environment" TEXT,
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ResourceEdge" (
    "id" TEXT NOT NULL,
    "fromNodeId" TEXT NOT NULL,
    "toNodeId" TEXT NOT NULL,
    "relationshipType" "public"."ResourceRelationshipType" NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResourceEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ServiceHealthSnapshot" (
    "id" TEXT NOT NULL,
    "resourceNodeId" TEXT NOT NULL,
    "healthState" "public"."ServiceHealthState" NOT NULL DEFAULT 'UNKNOWN',
    "signalSource" TEXT NOT NULL,
    "latencyMs" INTEGER,
    "errorRate" DOUBLE PRECISION,
    "metadata" JSONB,
    "measuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceHealthSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Runbook" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "ownerProduct" "public"."ProductKey",
    "serviceScope" TEXT,
    "riskTier" INTEGER NOT NULL DEFAULT 1,
    "orgId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Runbook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RunbookVersion" (
    "id" TEXT NOT NULL,
    "runbookId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "verificationDefinition" JSONB,
    "rollbackDefinition" JSONB,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "RunbookVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CommandDefinitionSnapshot" (
    "id" TEXT NOT NULL,
    "pilotRunId" TEXT NOT NULL,
    "commandName" TEXT NOT NULL,
    "registryVersion" TEXT,
    "definition" JSONB NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommandDefinitionSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CapabilityDefinitionSnapshot" (
    "id" TEXT NOT NULL,
    "pilotRunId" TEXT NOT NULL,
    "capabilityName" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CapabilityDefinitionSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "RevenueOnboardingContact_reference_key" ON "public"."RevenueOnboardingContact"("reference");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RevenueOnboardingContact_orgId_status_createdAt_idx" ON "public"."RevenueOnboardingContact"("orgId", "status", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RevenueOnboardingContact_contactEmail_createdAt_idx" ON "public"."RevenueOnboardingContact"("contactEmail", "createdAt");

-- CreateIndex
CREATE INDEX "PilotRun_status_startedAt_idx" ON "public"."PilotRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "PilotRun_orgId_startedAt_idx" ON "public"."PilotRun"("orgId", "startedAt");

-- CreateIndex
CREATE INDEX "PilotRun_actorUserId_startedAt_idx" ON "public"."PilotRun"("actorUserId", "startedAt");

-- CreateIndex
CREATE INDEX "PilotRun_commandName_startedAt_idx" ON "public"."PilotRun"("commandName", "startedAt");

-- CreateIndex
CREATE INDEX "PilotRunStep_status_startedAt_idx" ON "public"."PilotRunStep"("status", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PilotRunStep_pilotRunId_sequence_key" ON "public"."PilotRunStep"("pilotRunId", "sequence");

-- CreateIndex
CREATE INDEX "PilotEvent_pilotRunId_createdAt_idx" ON "public"."PilotEvent"("pilotRunId", "createdAt");

-- CreateIndex
CREATE INDEX "PilotEvent_pilotRunStepId_createdAt_idx" ON "public"."PilotEvent"("pilotRunStepId", "createdAt");

-- CreateIndex
CREATE INDEX "PilotPolicyDecision_pilotRunId_createdAt_idx" ON "public"."PilotPolicyDecision"("pilotRunId", "createdAt");

-- CreateIndex
CREATE INDEX "PilotPolicyDecision_decision_createdAt_idx" ON "public"."PilotPolicyDecision"("decision", "createdAt");

-- CreateIndex
CREATE INDEX "PilotApproval_status_requestedAt_idx" ON "public"."PilotApproval"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "PilotApproval_pilotRunId_requestedAt_idx" ON "public"."PilotApproval"("pilotRunId", "requestedAt");

-- CreateIndex
CREATE INDEX "PilotArtifact_pilotRunId_createdAt_idx" ON "public"."PilotArtifact"("pilotRunId", "createdAt");

-- CreateIndex
CREATE INDEX "PilotArtifact_artifactType_createdAt_idx" ON "public"."PilotArtifact"("artifactType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PilotExecutionLock_lockKey_key" ON "public"."PilotExecutionLock"("lockKey");

-- CreateIndex
CREATE INDEX "PilotExecutionLock_orgId_acquiredAt_idx" ON "public"."PilotExecutionLock"("orgId", "acquiredAt");

-- CreateIndex
CREATE INDEX "PilotExecutionLock_targetType_targetId_idx" ON "public"."PilotExecutionLock"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "PilotIncidentLink_pilotRunId_createdAt_idx" ON "public"."PilotIncidentLink"("pilotRunId", "createdAt");

-- CreateIndex
CREATE INDEX "PilotIncidentLink_incidentRef_createdAt_idx" ON "public"."PilotIncidentLink"("incidentRef", "createdAt");

-- CreateIndex
CREATE INDEX "ResourceNode_nodeType_createdAt_idx" ON "public"."ResourceNode"("nodeType", "createdAt");

-- CreateIndex
CREATE INDEX "ResourceNode_orgId_nodeType_idx" ON "public"."ResourceNode"("orgId", "nodeType");

-- CreateIndex
CREATE INDEX "ResourceNode_product_nodeType_idx" ON "public"."ResourceNode"("product", "nodeType");

-- CreateIndex
CREATE INDEX "ResourceEdge_fromNodeId_relationshipType_idx" ON "public"."ResourceEdge"("fromNodeId", "relationshipType");

-- CreateIndex
CREATE INDEX "ResourceEdge_toNodeId_relationshipType_idx" ON "public"."ResourceEdge"("toNodeId", "relationshipType");

-- CreateIndex
CREATE INDEX "ServiceHealthSnapshot_resourceNodeId_measuredAt_idx" ON "public"."ServiceHealthSnapshot"("resourceNodeId", "measuredAt");

-- CreateIndex
CREATE INDEX "ServiceHealthSnapshot_healthState_measuredAt_idx" ON "public"."ServiceHealthSnapshot"("healthState", "measuredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Runbook_slug_key" ON "public"."Runbook"("slug");

-- CreateIndex
CREATE INDEX "Runbook_status_updatedAt_idx" ON "public"."Runbook"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "Runbook_ownerProduct_updatedAt_idx" ON "public"."Runbook"("ownerProduct", "updatedAt");

-- CreateIndex
CREATE INDEX "RunbookVersion_publishedAt_idx" ON "public"."RunbookVersion"("publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RunbookVersion_runbookId_version_key" ON "public"."RunbookVersion"("runbookId", "version");

-- CreateIndex
CREATE INDEX "CommandDefinitionSnapshot_pilotRunId_capturedAt_idx" ON "public"."CommandDefinitionSnapshot"("pilotRunId", "capturedAt");

-- CreateIndex
CREATE INDEX "CommandDefinitionSnapshot_commandName_capturedAt_idx" ON "public"."CommandDefinitionSnapshot"("commandName", "capturedAt");

-- CreateIndex
CREATE INDEX "CapabilityDefinitionSnapshot_pilotRunId_capturedAt_idx" ON "public"."CapabilityDefinitionSnapshot"("pilotRunId", "capturedAt");

-- CreateIndex
CREATE INDEX "CapabilityDefinitionSnapshot_capabilityName_capturedAt_idx" ON "public"."CapabilityDefinitionSnapshot"("capabilityName", "capturedAt");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'RevenueOnboardingContact_orgId_fkey'
  ) THEN
    ALTER TABLE "public"."RevenueOnboardingContact"
      ADD CONSTRAINT "RevenueOnboardingContact_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

-- AddForeignKey
ALTER TABLE "public"."PilotRun" ADD CONSTRAINT "PilotRun_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PilotRun" ADD CONSTRAINT "PilotRun_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PilotRunStep" ADD CONSTRAINT "PilotRunStep_pilotRunId_fkey" FOREIGN KEY ("pilotRunId") REFERENCES "public"."PilotRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PilotEvent" ADD CONSTRAINT "PilotEvent_pilotRunId_fkey" FOREIGN KEY ("pilotRunId") REFERENCES "public"."PilotRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PilotEvent" ADD CONSTRAINT "PilotEvent_pilotRunStepId_fkey" FOREIGN KEY ("pilotRunStepId") REFERENCES "public"."PilotRunStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PilotPolicyDecision" ADD CONSTRAINT "PilotPolicyDecision_pilotRunId_fkey" FOREIGN KEY ("pilotRunId") REFERENCES "public"."PilotRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PilotApproval" ADD CONSTRAINT "PilotApproval_pilotRunId_fkey" FOREIGN KEY ("pilotRunId") REFERENCES "public"."PilotRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PilotApproval" ADD CONSTRAINT "PilotApproval_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PilotApproval" ADD CONSTRAINT "PilotApproval_approverUserId_fkey" FOREIGN KEY ("approverUserId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PilotArtifact" ADD CONSTRAINT "PilotArtifact_pilotRunId_fkey" FOREIGN KEY ("pilotRunId") REFERENCES "public"."PilotRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PilotArtifact" ADD CONSTRAINT "PilotArtifact_pilotRunStepId_fkey" FOREIGN KEY ("pilotRunStepId") REFERENCES "public"."PilotRunStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PilotExecutionLock" ADD CONSTRAINT "PilotExecutionLock_pilotRunId_fkey" FOREIGN KEY ("pilotRunId") REFERENCES "public"."PilotRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PilotIncidentLink" ADD CONSTRAINT "PilotIncidentLink_pilotRunId_fkey" FOREIGN KEY ("pilotRunId") REFERENCES "public"."PilotRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ResourceNode" ADD CONSTRAINT "ResourceNode_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ResourceEdge" ADD CONSTRAINT "ResourceEdge_fromNodeId_fkey" FOREIGN KEY ("fromNodeId") REFERENCES "public"."ResourceNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ResourceEdge" ADD CONSTRAINT "ResourceEdge_toNodeId_fkey" FOREIGN KEY ("toNodeId") REFERENCES "public"."ResourceNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ServiceHealthSnapshot" ADD CONSTRAINT "ServiceHealthSnapshot_resourceNodeId_fkey" FOREIGN KEY ("resourceNodeId") REFERENCES "public"."ResourceNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Runbook" ADD CONSTRAINT "Runbook_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RunbookVersion" ADD CONSTRAINT "RunbookVersion_runbookId_fkey" FOREIGN KEY ("runbookId") REFERENCES "public"."Runbook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CommandDefinitionSnapshot" ADD CONSTRAINT "CommandDefinitionSnapshot_pilotRunId_fkey" FOREIGN KEY ("pilotRunId") REFERENCES "public"."PilotRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CapabilityDefinitionSnapshot" ADD CONSTRAINT "CapabilityDefinitionSnapshot_pilotRunId_fkey" FOREIGN KEY ("pilotRunId") REFERENCES "public"."PilotRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
