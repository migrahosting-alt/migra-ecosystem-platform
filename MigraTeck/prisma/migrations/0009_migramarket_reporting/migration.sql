CREATE TABLE "public"."MigraMarketReportSnapshot" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "leads" INTEGER NOT NULL DEFAULT 0,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "bookedAppointments" INTEGER NOT NULL DEFAULT 0,
    "profileViews" INTEGER NOT NULL DEFAULT 0,
    "websiteSessions" INTEGER NOT NULL DEFAULT 0,
    "conversionRate" DOUBLE PRECISION,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "averageRating" DOUBLE PRECISION,
    "emailOpenRate" DOUBLE PRECISION,
    "socialReach" INTEGER NOT NULL DEFAULT 0,
    "adSpend" DOUBLE PRECISION,
    "costPerLead" DOUBLE PRECISION,
    "revenueAttributed" DOUBLE PRECISION,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MigraMarketReportSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MigraMarketReportSnapshot_orgId_periodEnd_createdAt_idx"
ON "public"."MigraMarketReportSnapshot"("orgId", "periodEnd", "createdAt");

ALTER TABLE "public"."MigraMarketReportSnapshot"
ADD CONSTRAINT "MigraMarketReportSnapshot_orgId_fkey"
FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
