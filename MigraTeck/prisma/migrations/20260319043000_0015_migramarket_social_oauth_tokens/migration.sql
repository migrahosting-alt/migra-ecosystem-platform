ALTER TABLE "public"."MigraMarketSocialConnection"
  ADD COLUMN "credentialCiphertext" TEXT,
  ADD COLUMN "refreshTokenCiphertext" TEXT,
  ADD COLUMN "tokenExpiresAt" TIMESTAMP(3);
