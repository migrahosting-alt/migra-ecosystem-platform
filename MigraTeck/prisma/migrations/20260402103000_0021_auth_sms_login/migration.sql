ALTER TABLE "public"."User"
ADD COLUMN "phoneE164" TEXT,
ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "User_phoneE164_key" ON "public"."User"("phoneE164");

CREATE TABLE "public"."SmsOtpChallenge" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "purpose" TEXT NOT NULL DEFAULT 'login',
  "codeHash" TEXT NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "ip" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SmsOtpChallenge_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SmsOtpChallenge_userId_purpose_createdAt_idx" ON "public"."SmsOtpChallenge"("userId", "purpose", "createdAt");
CREATE INDEX "SmsOtpChallenge_phone_purpose_createdAt_idx" ON "public"."SmsOtpChallenge"("phone", "purpose", "createdAt");
CREATE INDEX "SmsOtpChallenge_expiresAt_usedAt_idx" ON "public"."SmsOtpChallenge"("expiresAt", "usedAt");

ALTER TABLE "public"."SmsOtpChallenge"
ADD CONSTRAINT "SmsOtpChallenge_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;