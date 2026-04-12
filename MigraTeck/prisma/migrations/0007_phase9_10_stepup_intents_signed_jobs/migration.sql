CREATE TYPE "public"."StepUpMethod" AS ENUM ('NONE', 'REAUTH', 'TOTP', 'PASSKEY');
CREATE TYPE "public"."ProvisioningJobSource" AS ENUM ('STRIPE', 'ENTITLEMENT_EXPIRY', 'MANUAL', 'SYSTEM');
CREATE TYPE "public"."ProvisioningJobType" AS ENUM ('PROVISION', 'DEPROVISION', 'SCALE', 'RESTRICT', 'UNRESTRICT', 'ARTIFACT_GRANT');
CREATE TYPE "public"."ProvisioningJobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD', 'CANCELED');

CREATE TABLE "public"."UserTotpFactor" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "secretCiphertext" TEXT NOT NULL,
  "enabledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserTotpFactor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserTotpFactor_userId_key" ON "public"."UserTotpFactor"("userId");

CREATE TABLE "public"."MutationIntent" (
  "id" TEXT NOT NULL,
  "orgId" TEXT,
  "actorId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "riskTier" INTEGER NOT NULL DEFAULT 2,
  "payloadHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ip" TEXT,
  "userAgent" TEXT,
  "stepUpMethod" "public"."StepUpMethod" NOT NULL DEFAULT 'NONE',
  "stepUpVerifiedAt" TIMESTAMP(3),
  "reason" TEXT,
  CONSTRAINT "MutationIntent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MutationIntent_actorId_createdAt_idx" ON "public"."MutationIntent"("actorId", "createdAt");
CREATE INDEX "MutationIntent_orgId_createdAt_idx" ON "public"."MutationIntent"("orgId", "createdAt");
CREATE INDEX "MutationIntent_action_idx" ON "public"."MutationIntent"("action");
CREATE INDEX "MutationIntent_expiresAt_idx" ON "public"."MutationIntent"("expiresAt");
CREATE INDEX "MutationIntent_usedAt_idx" ON "public"."MutationIntent"("usedAt");

CREATE TABLE "public"."ProvisioningJob" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "createdByActorId" TEXT,
  "source" "public"."ProvisioningJobSource" NOT NULL,
  "type" "public"."ProvisioningJobType" NOT NULL,
  "status" "public"."ProvisioningJobStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "notBefore" TIMESTAMP(3),
  "lastError" TEXT,
  "lastErrorAt" TIMESTAMP(3),
  "lockedAt" TIMESTAMP(3),
  "lockedBy" TEXT,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "idempotencyKey" TEXT NOT NULL,
  "envelopeVersion" INTEGER NOT NULL DEFAULT 1,
  "payload" JSONB NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "signature" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProvisioningJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProvisioningJob_idempotencyKey_key" ON "public"."ProvisioningJob"("idempotencyKey");
CREATE INDEX "ProvisioningJob_status_notBefore_idx" ON "public"."ProvisioningJob"("status", "notBefore");
CREATE INDEX "ProvisioningJob_orgId_createdAt_idx" ON "public"."ProvisioningJob"("orgId", "createdAt");

CREATE TABLE "public"."ProvisioningJobEvent" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "status" "public"."ProvisioningJobStatus" NOT NULL,
  "message" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProvisioningJobEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProvisioningJobEvent_jobId_createdAt_idx" ON "public"."ProvisioningJobEvent"("jobId", "createdAt");

ALTER TABLE "public"."UserTotpFactor"
  ADD CONSTRAINT "UserTotpFactor_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."MutationIntent"
  ADD CONSTRAINT "MutationIntent_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "public"."MutationIntent"
  ADD CONSTRAINT "MutationIntent_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."ProvisioningJob"
  ADD CONSTRAINT "ProvisioningJob_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."ProvisioningJob"
  ADD CONSTRAINT "ProvisioningJob_createdByActorId_fkey"
  FOREIGN KEY ("createdByActorId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "public"."ProvisioningJobEvent"
  ADD CONSTRAINT "ProvisioningJobEvent_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "public"."ProvisioningJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
