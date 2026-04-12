-- CreateEnum
CREATE TYPE "public"."BillingProvider" AS ENUM ('STRIPE');

-- CreateEnum
CREATE TYPE "public"."BillingSubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'INCOMPLETE', 'INCOMPLETE_EXPIRED', 'UNPAID', 'PAUSED');

-- CreateEnum
CREATE TYPE "public"."ProvisioningAction" AS ENUM ('POD_CREATE', 'POD_SCALE_DOWN', 'DNS_PROVISION', 'MAIL_DISABLE', 'STORAGE_PROVISION', 'STORAGE_READ_ONLY');

-- CreateEnum
CREATE TYPE "public"."ProvisioningTaskStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "public"."BillingCustomer" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" "public"."BillingProvider" NOT NULL DEFAULT 'STRIPE',
    "externalCustomerId" TEXT NOT NULL,
    "email" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BillingSubscription" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" "public"."BillingProvider" NOT NULL DEFAULT 'STRIPE',
    "externalSubscriptionId" TEXT NOT NULL,
    "externalCustomerId" TEXT,
    "status" "public"."BillingSubscriptionStatus" NOT NULL,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "canceledAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BillingEntitlementBinding" (
    "id" TEXT NOT NULL,
    "provider" "public"."BillingProvider" NOT NULL DEFAULT 'STRIPE',
    "externalPriceId" TEXT NOT NULL,
    "product" "public"."ProductKey" NOT NULL,
    "statusOnActive" "public"."EntitlementStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingEntitlementBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProvisioningTask" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "product" "public"."ProductKey",
    "action" "public"."ProvisioningAction" NOT NULL,
    "status" "public"."ProvisioningTaskStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "runAfter" TIMESTAMP(3),
    "lastError" TEXT,
    "payload" JSONB,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProvisioningTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingCustomer_externalCustomerId_key" ON "public"."BillingCustomer"("externalCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingCustomer_orgId_provider_key" ON "public"."BillingCustomer"("orgId", "provider");

-- CreateIndex
CREATE INDEX "BillingCustomer_provider_externalCustomerId_idx" ON "public"."BillingCustomer"("provider", "externalCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingSubscription_externalSubscriptionId_key" ON "public"."BillingSubscription"("externalSubscriptionId");

-- CreateIndex
CREATE INDEX "BillingSubscription_orgId_status_idx" ON "public"."BillingSubscription"("orgId", "status");

-- CreateIndex
CREATE INDEX "BillingSubscription_provider_externalCustomerId_idx" ON "public"."BillingSubscription"("provider", "externalCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingEntitlementBinding_externalPriceId_key" ON "public"."BillingEntitlementBinding"("externalPriceId");

-- CreateIndex
CREATE INDEX "BillingEntitlementBinding_provider_product_idx" ON "public"."BillingEntitlementBinding"("provider", "product");

-- CreateIndex
CREATE INDEX "ProvisioningTask_orgId_status_createdAt_idx" ON "public"."ProvisioningTask"("orgId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ProvisioningTask_status_runAfter_createdAt_idx" ON "public"."ProvisioningTask"("status", "runAfter", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."BillingCustomer" ADD CONSTRAINT "BillingCustomer_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BillingSubscription" ADD CONSTRAINT "BillingSubscription_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProvisioningTask" ADD CONSTRAINT "ProvisioningTask_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProvisioningTask" ADD CONSTRAINT "ProvisioningTask_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
