-- AlterTable
ALTER TABLE "public"."PlatformConfig"
  ADD COLUMN "maintenanceMode" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "freezeProvisioning" BOOLEAN NOT NULL DEFAULT false;
