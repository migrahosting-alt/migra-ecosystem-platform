DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'DriveFileStatus'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE "public"."DriveFileStatus" AS ENUM ('PENDING_UPLOAD', 'ACTIVE', 'DELETED');
  END IF;
END $$;

CREATE TABLE "DriveFile" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "parentPath" TEXT,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" BIGINT NOT NULL,
  "checksumSha256" TEXT,
  "status" "public"."DriveFileStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "uploadedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "DriveFile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DriveFile_objectKey_key" ON "DriveFile"("objectKey");
CREATE INDEX "DriveFile_orgId_status_createdAt_idx" ON "DriveFile"("orgId", "status", "createdAt");
CREATE INDEX "DriveFile_tenantId_status_createdAt_idx" ON "DriveFile"("tenantId", "status", "createdAt");
CREATE INDEX "DriveFile_orgId_parentPath_fileName_idx" ON "DriveFile"("orgId", "parentPath", "fileName");

ALTER TABLE "DriveFile"
  ADD CONSTRAINT "DriveFile_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "DriveTenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DriveFile"
  ADD CONSTRAINT "DriveFile_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;