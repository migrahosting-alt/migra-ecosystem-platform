CREATE TABLE "public"."MigraMarketAccount" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "packageName" TEXT,
    "clientStage" TEXT NOT NULL DEFAULT 'onboarding',
    "healthStatus" TEXT NOT NULL DEFAULT 'needs_attention',
    "primaryGoals" JSONB,
    "targetMarkets" JSONB,
    "googleBusinessProfileUrl" TEXT,
    "websiteUrl" TEXT,
    "socialProfiles" JSONB,
    "adBudgetMonthly" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MigraMarketAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."MigraMarketLocation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "region" TEXT,
    "country" TEXT NOT NULL DEFAULT 'US',
    "serviceArea" TEXT,
    "primaryPhone" TEXT,
    "primary" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MigraMarketLocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."MigraMarketChecklistItem" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "owner" TEXT,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MigraMarketChecklistItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."MigraMarketTask" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'fulfillment',
    "status" TEXT NOT NULL DEFAULT 'todo',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "assignee" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MigraMarketTask_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MigraMarketAccount_orgId_key" ON "public"."MigraMarketAccount"("orgId");
CREATE INDEX "MigraMarketAccount_clientStage_updatedAt_idx" ON "public"."MigraMarketAccount"("clientStage", "updatedAt");
CREATE INDEX "MigraMarketLocation_orgId_status_createdAt_idx" ON "public"."MigraMarketLocation"("orgId", "status", "createdAt");
CREATE UNIQUE INDEX "MigraMarketChecklistItem_orgId_key_key" ON "public"."MigraMarketChecklistItem"("orgId", "key");
CREATE INDEX "MigraMarketChecklistItem_orgId_status_sortOrder_idx" ON "public"."MigraMarketChecklistItem"("orgId", "status", "sortOrder");
CREATE INDEX "MigraMarketTask_orgId_status_createdAt_idx" ON "public"."MigraMarketTask"("orgId", "status", "createdAt");
CREATE INDEX "MigraMarketTask_orgId_priority_dueAt_idx" ON "public"."MigraMarketTask"("orgId", "priority", "dueAt");

ALTER TABLE "public"."MigraMarketAccount"
ADD CONSTRAINT "MigraMarketAccount_orgId_fkey"
FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."MigraMarketLocation"
ADD CONSTRAINT "MigraMarketLocation_orgId_fkey"
FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."MigraMarketChecklistItem"
ADD CONSTRAINT "MigraMarketChecklistItem_orgId_fkey"
FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."MigraMarketTask"
ADD CONSTRAINT "MigraMarketTask_orgId_fkey"
FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
