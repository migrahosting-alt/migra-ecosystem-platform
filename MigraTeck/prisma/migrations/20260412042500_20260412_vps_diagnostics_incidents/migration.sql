-- CreateEnum
CREATE TYPE "VpsIncidentState" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'MITIGATING', 'RESOLVED');

-- CreateTable
CREATE TABLE "VpsIncident" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "alertId" TEXT,
    "state" "VpsIncidentState" NOT NULL DEFAULT 'OPEN',
    "severity" "AlertSeverity" NOT NULL DEFAULT 'WARNING',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responseDeadlineAt" TIMESTAMP(3),
    "mitigationDeadlineAt" TIMESTAMP(3),
    "breachedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VpsIncident_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VpsIncident_alertId_key" ON "VpsIncident"("alertId");

-- CreateIndex
CREATE INDEX "VpsIncident_orgId_state_openedAt_idx" ON "VpsIncident"("orgId", "state", "openedAt");

-- CreateIndex
CREATE INDEX "VpsIncident_serverId_state_openedAt_idx" ON "VpsIncident"("serverId", "state", "openedAt");

-- AddForeignKey
ALTER TABLE "VpsIncident" ADD CONSTRAINT "VpsIncident_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "VpsServer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VpsIncident" ADD CONSTRAINT "VpsIncident_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE SET NULL ON UPDATE CASCADE;