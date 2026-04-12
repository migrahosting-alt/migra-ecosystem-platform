CREATE TYPE "DriveTenantActorType" AS ENUM ('SYSTEM', 'ADMIN', 'USER');

ALTER TABLE "DriveTenantEvent"
ALTER COLUMN "actorType" TYPE "DriveTenantActorType"
USING (
  CASE
    WHEN "actorType" = 'system' THEN 'SYSTEM'::"DriveTenantActorType"
    WHEN "actorType" = 'admin' THEN 'ADMIN'::"DriveTenantActorType"
    WHEN "actorType" = 'user' THEN 'USER'::"DriveTenantActorType"
    ELSE 'SYSTEM'::"DriveTenantActorType"
  END
);