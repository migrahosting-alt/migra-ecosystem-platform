-- Tenant-native MigraIntake foundation.
--
-- The legacy /opt/migra-intake runtime stays untouched. These organization-
-- scoped tables are the new Platform-owned authority for forms and submissions.
-- Submission payloads are encrypted by the application before persistence.

CREATE TABLE IF NOT EXISTS "IntakeForm" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "publicKey" TEXT NOT NULL,
  "schemaJson" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "settingsJson" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IntakeForm_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "IntakeForm_status_check"
    CHECK ("status" IN ('DRAFT','ACTIVE','PAUSED','ARCHIVED')),
  CONSTRAINT "IntakeForm_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "IntakeForm_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "IntakeForm_publicKey_key"
  ON "IntakeForm"("publicKey");

CREATE UNIQUE INDEX IF NOT EXISTS "IntakeForm_orgId_slug_key"
  ON "IntakeForm"("orgId","slug");

CREATE INDEX IF NOT EXISTS "IntakeForm_orgId_status_idx"
  ON "IntakeForm"("orgId","status");

CREATE TABLE IF NOT EXISTS "IntakeSubmission" (
  "id" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "formId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'NEW',
  "payloadCiphertext" TEXT NOT NULL,
  "payloadIv" TEXT NOT NULL,
  "payloadTag" TEXT NOT NULL,
  "encryptionVersion" INTEGER NOT NULL DEFAULT 1,
  "source" TEXT NOT NULL DEFAULT 'public',
  "idempotencyKey" TEXT,
  "metadataJson" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "reviewedById" TEXT,
  CONSTRAINT "IntakeSubmission_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "IntakeSubmission_status_check"
    CHECK ("status" IN ('NEW','IN_REVIEW','RESOLVED','SPAM')),
  CONSTRAINT "IntakeSubmission_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "IntakeSubmission_formId_fkey"
    FOREIGN KEY ("formId") REFERENCES "IntakeForm"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "IntakeSubmission_reviewedById_fkey"
    FOREIGN KEY ("reviewedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "IntakeSubmission_formId_idempotencyKey_key"
  ON "IntakeSubmission"("formId","idempotencyKey");

CREATE INDEX IF NOT EXISTS "IntakeSubmission_orgId_submittedAt_idx"
  ON "IntakeSubmission"("orgId","submittedAt");

CREATE INDEX IF NOT EXISTS "IntakeSubmission_formId_status_submittedAt_idx"
  ON "IntakeSubmission"("formId","status","submittedAt");
