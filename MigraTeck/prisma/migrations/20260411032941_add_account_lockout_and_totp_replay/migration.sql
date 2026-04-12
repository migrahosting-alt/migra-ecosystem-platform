-- AlterTable
ALTER TABLE "User" ADD COLUMN     "accountLockedUntil" TIMESTAMP(3),
ADD COLUMN     "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "TotpCodeUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TotpCodeUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TotpCodeUsage_expiresAt_idx" ON "TotpCodeUsage"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "TotpCodeUsage_userId_codeHash_key" ON "TotpCodeUsage"("userId", "codeHash");
