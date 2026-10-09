CREATE TABLE IF NOT EXISTS "BillingCatalogProduct" (
  "id" TEXT NOT NULL,
  "productFamily" TEXT NOT NULL,
  "productKey" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sourceHash" TEXT NOT NULL,
  "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingCatalogProduct_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BillingCatalogProduct_productFamily_key"
  ON "BillingCatalogProduct" ("productFamily");

CREATE INDEX IF NOT EXISTS "BillingCatalogProduct_active_idx"
  ON "BillingCatalogProduct" ("active");

CREATE TABLE IF NOT EXISTS "BillingCatalogPlan" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "planCode" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "trialDays" INTEGER,
  "entitlements" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sourceHash" TEXT NOT NULL,
  "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingCatalogPlan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BillingCatalogPlan_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "BillingCatalogProduct"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "BillingCatalogPlan_productId_planCode_key"
  ON "BillingCatalogPlan" ("productId", "planCode");

CREATE INDEX IF NOT EXISTS "BillingCatalogPlan_productId_idx"
  ON "BillingCatalogPlan" ("productId");

CREATE INDEX IF NOT EXISTS "BillingCatalogPlan_active_idx"
  ON "BillingCatalogPlan" ("active");

CREATE TABLE IF NOT EXISTS "BillingCatalogPrice" (
  "id" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "lookupKey" TEXT NOT NULL,
  "componentType" TEXT NOT NULL,
  "billingInterval" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'usd',
  "unitAmount" INTEGER,
  "meterName" TEXT,
  "usageDimension" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sourceHash" TEXT NOT NULL,
  "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingCatalogPrice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BillingCatalogPrice_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "BillingCatalogPlan"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "BillingCatalogPrice_lookupKey_key"
  ON "BillingCatalogPrice" ("lookupKey");

CREATE INDEX IF NOT EXISTS "BillingCatalogPrice_planId_idx"
  ON "BillingCatalogPrice" ("planId");

CREATE INDEX IF NOT EXISTS "BillingCatalogPrice_active_idx"
  ON "BillingCatalogPrice" ("active");

CREATE TABLE IF NOT EXISTS "BillingCatalogSync" (
  "id" TEXT NOT NULL,
  "sourceDigest" TEXT NOT NULL,
  "sourceVersion" TEXT,
  "productCount" INTEGER NOT NULL,
  "planCount" INTEGER NOT NULL,
  "priceCount" INTEGER NOT NULL,
  "retiredProductCount" INTEGER NOT NULL DEFAULT 0,
  "retiredPlanCount" INTEGER NOT NULL DEFAULT 0,
  "retiredPriceCount" INTEGER NOT NULL DEFAULT 0,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingCatalogSync_pkey" PRIMARY KEY ("id")
);
