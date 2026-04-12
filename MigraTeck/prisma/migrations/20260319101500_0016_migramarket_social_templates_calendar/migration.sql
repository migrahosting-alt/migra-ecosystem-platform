-- CreateTable
CREATE TABLE "MigraMarketContentTemplate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'post',
    "cadence" TEXT NOT NULL DEFAULT 'weekly',
    "publishMode" TEXT NOT NULL DEFAULT 'assisted',
    "titleTemplate" TEXT NOT NULL,
    "captionTemplate" TEXT,
    "aiPromptTemplate" TEXT,
    "cta" TEXT,
    "hashtags" JSONB,
    "diversityChecklist" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MigraMarketContentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MigraMarketContentCalendarSlot" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "templateId" TEXT,
    "connectionId" TEXT,
    "title" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'post',
    "publishMode" TEXT NOT NULL DEFAULT 'assisted',
    "weekday" INTEGER NOT NULL,
    "slotTime" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'planned',
    "theme" TEXT,
    "cta" TEXT,
    "aiPrompt" TEXT,
    "assetChecklist" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MigraMarketContentCalendarSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MigraMarketContentTemplate_orgId_status_platform_idx" ON "MigraMarketContentTemplate"("orgId", "status", "platform");

-- CreateIndex
CREATE INDEX "MigraMarketContentTemplate_orgId_cadence_createdAt_idx" ON "MigraMarketContentTemplate"("orgId", "cadence", "createdAt");

-- CreateIndex
CREATE INDEX "MigraMarketContentCalendarSlot_orgId_weekday_status_idx" ON "MigraMarketContentCalendarSlot"("orgId", "weekday", "status");

-- CreateIndex
CREATE INDEX "MigraMarketContentCalendarSlot_orgId_scheduledFor_idx" ON "MigraMarketContentCalendarSlot"("orgId", "scheduledFor");

-- AddForeignKey
ALTER TABLE "MigraMarketContentTemplate" ADD CONSTRAINT "MigraMarketContentTemplate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MigraMarketContentCalendarSlot" ADD CONSTRAINT "MigraMarketContentCalendarSlot_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MigraMarketContentCalendarSlot" ADD CONSTRAINT "MigraMarketContentCalendarSlot_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MigraMarketContentTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MigraMarketContentCalendarSlot" ADD CONSTRAINT "MigraMarketContentCalendarSlot_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "MigraMarketSocialConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
