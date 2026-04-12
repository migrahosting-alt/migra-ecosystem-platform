-- CreateEnum
CREATE TYPE "VpsAlertRuleStatus" AS ENUM ('ENABLED', 'DISABLED');

-- CreateEnum
CREATE TYPE "VpsAlertEventStatus" AS ENUM ('ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'SUPPRESSED');

-- CreateTable
CREATE TABLE "VpsAlertRule" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "VpsAlertRuleStatus" NOT NULL DEFAULT 'ENABLED',
    "severity" "AlertSeverity" NOT NULL DEFAULT 'WARNING',
    "escalationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "responseSlaMinutes" INTEGER,
    "mitigationSlaMinutes" INTEGER,
    "suppressionMinutes" INTEGER NOT NULL DEFAULT 60,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VpsAlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VpsAlertEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "alertId" TEXT,
    "status" "VpsAlertEventStatus" NOT NULL DEFAULT 'ACTIVE',
    "fingerprint" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL DEFAULT 'WARNING',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "detailJson" JSONB,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "firstDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "suppressedUntil" TIMESTAMP(3),
    "lastRemediationJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VpsAlertEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VpsAlertRule_orgId_code_key" ON "VpsAlertRule"("orgId", "code");

-- CreateIndex
CREATE INDEX "VpsAlertRule_orgId_status_severity_idx" ON "VpsAlertRule"("orgId", "status", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "VpsAlertEvent_serverId_fingerprint_key" ON "VpsAlertEvent"("serverId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "VpsAlertEvent_alertId_key" ON "VpsAlertEvent"("alertId");

-- CreateIndex
CREATE INDEX "VpsAlertEvent_orgId_status_severity_lastDetectedAt_idx" ON "VpsAlertEvent"("orgId", "status", "severity", "lastDetectedAt");

-- CreateIndex
CREATE INDEX "VpsAlertEvent_serverId_status_lastDetectedAt_idx" ON "VpsAlertEvent"("serverId", "status", "lastDetectedAt");

-- AddForeignKey
ALTER TABLE "VpsAlertRule" ADD CONSTRAINT "VpsAlertRule_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VpsAlertEvent" ADD CONSTRAINT "VpsAlertEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VpsAlertEvent" ADD CONSTRAINT "VpsAlertEvent_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "VpsServer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VpsAlertEvent" ADD CONSTRAINT "VpsAlertEvent_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "VpsAlertRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VpsAlertEvent" ADD CONSTRAINT "VpsAlertEvent_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE SET NULL ON UPDATE CASCADE;