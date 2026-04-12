-- CreateEnum
CREATE TYPE "VpsStatus" AS ENUM ('PROVISIONING', 'RUNNING', 'STOPPED', 'REBOOTING', 'RESCUED', 'REBUILDING', 'SUSPENDED', 'TERMINATED', 'ERROR');

-- CreateEnum
CREATE TYPE "ServerPowerState" AS ENUM ('ON', 'OFF', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "VpsBillingCycle" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "VpsActionType" AS ENUM ('POWER_ON', 'POWER_OFF', 'REBOOT', 'HARD_REBOOT', 'ENABLE_RESCUE', 'DISABLE_RESCUE', 'REBUILD', 'OPEN_CONSOLE_SESSION', 'CREATE_SNAPSHOT', 'RESTORE_SNAPSHOT', 'DELETE_SNAPSHOT', 'UPDATE_FIREWALL', 'ROLLBACK_FIREWALL', 'UPDATE_BACKUP_POLICY', 'MANUAL_SYNC');

-- CreateEnum
CREATE TYPE "VpsActionStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "VpsSnapshotStatus" AS ENUM ('CREATING', 'READY', 'RESTORING', 'FAILED', 'DELETING');

-- CreateEnum
CREATE TYPE "VpsBackupPolicyStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DISABLED');

-- CreateEnum
CREATE TYPE "VpsAuditSeverity" AS ENUM ('INFO', 'WARNING', 'ERROR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "FirewallDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "FirewallAction" AS ENUM ('ALLOW', 'DENY');

-- CreateEnum
CREATE TYPE "FirewallProtocol" AS ENUM ('TCP', 'UDP', 'ICMP', 'ANY');

-- CreateEnum
CREATE TYPE "FirewallProfileStatus" AS ENUM ('DRAFT', 'ACTIVE', 'APPLYING', 'FAILED', 'DISABLED');

-- CreateEnum
CREATE TYPE "ConsoleSessionStatus" AS ENUM ('REQUESTED', 'READY', 'ACTIVE', 'EXPIRED', 'FAILED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SupportTier" AS ENUM ('STANDARD', 'PRIORITY', 'MANAGED', 'EMERGENCY');

-- CreateTable
CREATE TABLE "VpsServer" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "customerUserId" TEXT,
    "providerSlug" TEXT NOT NULL DEFAULT 'manual',
    "providerServerId" TEXT,
    "providerRegionId" TEXT,
    "providerPlanId" TEXT,
    "name" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "status" "VpsStatus" NOT NULL DEFAULT 'PROVISIONING',
    "powerState" "ServerPowerState" NOT NULL DEFAULT 'UNKNOWN',
    "publicIpv4" TEXT NOT NULL,
    "privateIpv4" TEXT,
    "gatewayIpv4" TEXT,
    "privateNetwork" TEXT,
    "sshPort" INTEGER NOT NULL DEFAULT 22,
    "defaultUsername" TEXT NOT NULL DEFAULT 'root',
    "region" TEXT NOT NULL,
    "datacenterLabel" TEXT,
    "imageSlug" TEXT NOT NULL,
    "osName" TEXT NOT NULL,
    "imageVersion" TEXT,
    "virtualizationType" TEXT,
    "planSlug" TEXT NOT NULL,
    "planName" TEXT,
    "vcpu" INTEGER NOT NULL,
    "memoryMb" INTEGER NOT NULL,
    "diskGb" INTEGER NOT NULL,
    "bandwidthTb" INTEGER NOT NULL,
    "bandwidthUsedGb" INTEGER NOT NULL DEFAULT 0,
    "reverseDns" TEXT,
    "reverseDnsStatus" TEXT,
    "firewallEnabled" BOOLEAN NOT NULL DEFAULT true,
    "firewallProfileName" TEXT,
    "monitoringEnabled" BOOLEAN NOT NULL DEFAULT false,
    "monitoringStatus" TEXT,
    "backupsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "backupRegion" TEXT,
    "snapshotCountCached" INTEGER NOT NULL DEFAULT 0,
    "nextInvoiceAt" TIMESTAMP(3),
    "renewalAt" TIMESTAMP(3),
    "billingCycle" "VpsBillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "monthlyPriceCents" INTEGER NOT NULL DEFAULT 0,
    "billingCurrency" TEXT NOT NULL DEFAULT 'USD',
    "supportTier" "SupportTier",
    "supportTicketUrl" TEXT,
    "supportDocsUrl" TEXT,
    "rescueEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" TIMESTAMP(3),
    "lastKnownProviderStateJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VpsServer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VpsActionJob" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "action" "VpsActionType" NOT NULL,
    "status" "VpsActionStatus" NOT NULL DEFAULT 'QUEUED',
    "requestedByUserId" TEXT NOT NULL,
    "requestJson" JSONB,
    "resultJson" JSONB,
    "errorJson" JSONB,
    "providerRequestId" TEXT,
    "providerTaskId" TEXT,
    "correlationId" TEXT NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "nextPollAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VpsActionJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VpsSnapshot" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "status" "VpsSnapshotStatus" NOT NULL DEFAULT 'CREATING',
    "sizeGb" INTEGER,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VpsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VpsBackupPolicy" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "status" "VpsBackupPolicyStatus" NOT NULL DEFAULT 'DISABLED',
    "frequency" TEXT NOT NULL,
    "retentionCount" INTEGER NOT NULL,
    "lastSuccessAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "encrypted" BOOLEAN NOT NULL DEFAULT true,
    "crossRegion" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VpsBackupPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VpsMetricRollup" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "cpuPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "memoryPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "diskPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "networkInMbps" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "networkOutMbps" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "uptimeSeconds" BIGINT NOT NULL DEFAULT 0,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VpsMetricRollup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VpsAuditEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "eventType" TEXT NOT NULL,
    "severity" "VpsAuditSeverity" NOT NULL DEFAULT 'INFO',
    "sourceIp" TEXT,
    "relatedJobId" TEXT,
    "payloadJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VpsAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VpsFirewallProfile" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "providerProfileId" TEXT,
    "name" TEXT NOT NULL,
    "status" "FirewallProfileStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "defaultInboundAction" "FirewallAction" NOT NULL DEFAULT 'DENY',
    "defaultOutboundAction" "FirewallAction" NOT NULL DEFAULT 'ALLOW',
    "antiLockoutEnabled" BOOLEAN NOT NULL DEFAULT true,
    "rollbackWindowSec" INTEGER NOT NULL DEFAULT 120,
    "protectionMode" TEXT,
    "providerVersion" TEXT,
    "lastAppliedAt" TIMESTAMP(3),
    "lastApplyJobId" TEXT,
    "lastError" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "rollbackPendingUntil" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "driftDetectedAt" TIMESTAMP(3),
    "driftSummaryJson" JSONB,
    "lastKnownGoodJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VpsFirewallProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VpsFirewallRule" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "direction" "FirewallDirection" NOT NULL,
    "action" "FirewallAction" NOT NULL,
    "protocol" "FirewallProtocol" NOT NULL DEFAULT 'TCP',
    "portStart" INTEGER,
    "portEnd" INTEGER,
    "portRange" TEXT,
    "sourceCidr" TEXT,
    "destinationCidr" TEXT,
    "description" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VpsFirewallRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VpsSupportLink" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "externalTicketId" TEXT,
    "title" TEXT,
    "category" TEXT,
    "priority" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "url" TEXT,
    "metadataJson" JSONB,
    "lastUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VpsSupportLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VpsConsoleSession" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "providerSessionId" TEXT,
    "launchUrl" TEXT,
    "tokenPreview" TEXT,
    "status" "ConsoleSessionStatus" NOT NULL DEFAULT 'REQUESTED',
    "createdByUserId" TEXT,
    "viewOnly" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "lastConnectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VpsConsoleSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VpsProviderBinding" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "providerSlug" TEXT NOT NULL,
    "providerServerId" TEXT NOT NULL,
    "providerRegionId" TEXT,
    "providerPlanId" TEXT,
    "metadataJson" JSONB,
    "lastKnownStateJson" JSONB,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VpsProviderBinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VpsServer_providerServerId_key" ON "VpsServer"("providerServerId");

-- CreateIndex
CREATE INDEX "VpsServer_orgId_createdAt_idx" ON "VpsServer"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "VpsServer_orgId_status_idx" ON "VpsServer"("orgId", "status");

-- CreateIndex
CREATE INDEX "VpsActionJob_orgId_createdAt_idx" ON "VpsActionJob"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "VpsActionJob_serverId_createdAt_idx" ON "VpsActionJob"("serverId", "createdAt");

-- CreateIndex
CREATE INDEX "VpsActionJob_status_createdAt_idx" ON "VpsActionJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "VpsActionJob_providerTaskId_idx" ON "VpsActionJob"("providerTaskId");

-- CreateIndex
CREATE INDEX "VpsSnapshot_serverId_createdAt_idx" ON "VpsSnapshot"("serverId", "createdAt");

-- CreateIndex
CREATE INDEX "VpsBackupPolicy_serverId_updatedAt_idx" ON "VpsBackupPolicy"("serverId", "updatedAt");

-- CreateIndex
CREATE INDEX "VpsMetricRollup_serverId_capturedAt_idx" ON "VpsMetricRollup"("serverId", "capturedAt");

-- CreateIndex
CREATE INDEX "VpsAuditEvent_orgId_createdAt_idx" ON "VpsAuditEvent"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "VpsAuditEvent_serverId_createdAt_idx" ON "VpsAuditEvent"("serverId", "createdAt");

-- CreateIndex
CREATE INDEX "VpsFirewallProfile_serverId_updatedAt_idx" ON "VpsFirewallProfile"("serverId", "updatedAt");

-- CreateIndex
CREATE INDEX "VpsFirewallProfile_serverId_isActive_idx" ON "VpsFirewallProfile"("serverId", "isActive");

-- CreateIndex
CREATE INDEX "VpsFirewallRule_profileId_priority_idx" ON "VpsFirewallRule"("profileId", "priority");

-- CreateIndex
CREATE INDEX "VpsFirewallRule_profileId_direction_priority_idx" ON "VpsFirewallRule"("profileId", "direction", "priority");

-- CreateIndex
CREATE INDEX "VpsSupportLink_serverId_updatedAt_idx" ON "VpsSupportLink"("serverId", "updatedAt");

-- CreateIndex
CREATE INDEX "VpsConsoleSession_serverId_createdAt_idx" ON "VpsConsoleSession"("serverId", "createdAt");

-- CreateIndex
CREATE INDEX "VpsConsoleSession_status_createdAt_idx" ON "VpsConsoleSession"("status", "createdAt");

-- CreateIndex
CREATE INDEX "VpsProviderBinding_serverId_updatedAt_idx" ON "VpsProviderBinding"("serverId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "VpsProviderBinding_providerSlug_providerServerId_key" ON "VpsProviderBinding"("providerSlug", "providerServerId");

-- AddForeignKey
ALTER TABLE "VpsServer" ADD CONSTRAINT "VpsServer_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VpsActionJob" ADD CONSTRAINT "VpsActionJob_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "VpsServer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VpsSnapshot" ADD CONSTRAINT "VpsSnapshot_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "VpsServer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VpsBackupPolicy" ADD CONSTRAINT "VpsBackupPolicy_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "VpsServer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VpsMetricRollup" ADD CONSTRAINT "VpsMetricRollup_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "VpsServer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VpsAuditEvent" ADD CONSTRAINT "VpsAuditEvent_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "VpsServer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VpsFirewallProfile" ADD CONSTRAINT "VpsFirewallProfile_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "VpsServer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VpsFirewallRule" ADD CONSTRAINT "VpsFirewallRule_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "VpsFirewallProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VpsSupportLink" ADD CONSTRAINT "VpsSupportLink_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "VpsServer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VpsConsoleSession" ADD CONSTRAINT "VpsConsoleSession_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "VpsServer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VpsProviderBinding" ADD CONSTRAINT "VpsProviderBinding_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "VpsServer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
