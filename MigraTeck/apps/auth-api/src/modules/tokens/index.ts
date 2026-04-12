/**
 * Tokens module — auth code issuance/exchange, refresh token rotation.
 * Models: OAuthAuthorizationCode, OAuthRefreshToken (scope as text).
 */
import { db } from "../../lib/db.js";
import { generateToken, hashToken, verifyCodeChallenge } from "../../lib/crypto.js";
import { issueAccessToken, issueIdToken } from "../../lib/jwt.js";
import { config } from "../../config/env.js";
import { randomUUID } from "node:crypto";
import type { User } from ".prisma/auth-client";

// ── Auth Code ───────────────────────────────────────────────────────

export async function createAuthCode(
  userId: string,
  clientId: string,
  redirectUri: string,
  codeChallenge: string,
  codeChallengeMethod: string,
  scopes: string[],
  nonce?: string,
  opts?: { stateHash?: string; nonceHash?: string; issuedIp?: string; issuedUserAgent?: string },
): Promise<string> {
  const code = generateToken(32);
  const codeHash = hashToken(code);
  const expiresAt = new Date(Date.now() + config.authCodeTtl * 1000);

  await db.oAuthAuthorizationCode.create({
    data: {
      userId,
      clientId,
      codeHash,
      codeChallenge,
      codeChallengeMethod,
      redirectUri,
      scope: scopes.join(" "),
      nonce: nonce ?? null,
      stateHash: opts?.stateHash ?? null,
      nonceHash: opts?.nonceHash ?? null,
      issuedIp: opts?.issuedIp ?? null,
      issuedUserAgent: opts?.issuedUserAgent ?? null,
      expiresAt,
    },
  });

  return code;
}

export interface TokenSet {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  id_token?: string;
  scope: string;
}

export async function exchangeAuthCode(
  code: string,
  codeVerifier: string,
  clientId: string,
  redirectUri: string,
): Promise<TokenSet | null> {
  const codeHash = hashToken(code);
  const authCode = await db.oAuthAuthorizationCode.findFirst({
    where: {
      codeHash,
      clientId,
      redirectUri,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
  });

  if (!authCode) return null;

  // Mark as used immediately (one-time)
  await db.oAuthAuthorizationCode.update({
    where: { id: authCode.id },
    data: { usedAt: new Date() },
  });

  // Verify PKCE
  if (!verifyCodeChallenge(codeVerifier, authCode.codeChallenge)) {
    return null;
  }

  // Fetch user
  const user = await db.user.findUnique({ where: { id: authCode.userId } });
  if (!user) return null;

  const scopeStr = authCode.scope;
  const scopes = scopeStr.split(" ");

  // Issue tokens
  const access_token = await issueAccessToken({
    sub: user.id,
    email: user.email,
    email_verified: !!user.emailVerifiedAt,
    scope: scopeStr,
    client_id: clientId,
  });

  const refresh_token = await createRefreshToken(user.id, clientId, undefined, undefined, scopeStr);

  let id_token: string | undefined;
  if (scopes.includes("openid")) {
    id_token = await issueIdToken(
      {
        sub: user.id,
        email: user.email,
        email_verified: !!user.emailVerifiedAt,
        name: user.displayName ?? undefined,
        given_name: user.givenName ?? undefined,
        family_name: user.familyName ?? undefined,
        picture: user.avatarUrl ?? undefined,
      },
      clientId,
      authCode.nonce ?? undefined,
    );
  }

  return {
    access_token,
    token_type: "Bearer",
    expires_in: config.accessTokenTtl,
    refresh_token,
    id_token,
    scope: scopeStr,
  };
}

// ── Refresh Tokens ──────────────────────────────────────────────────

async function createRefreshToken(
  userId: string,
  clientId: string,
  familyId?: string,
  parentTokenId?: string,
  scope?: string,
  ipAddress?: string,
  userAgent?: string,
): Promise<string> {
  const token = generateToken(48);
  const tokenHash = hashToken(token);
  const fid = familyId ?? randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.refreshTokenTtl * 1000);

  await db.oAuthRefreshToken.create({
    data: {
      userId,
      clientId,
      tokenHash,
      familyId: fid,
      parentTokenId: parentTokenId ?? null,
      scope: scope ?? "openid",
      issuedAt: now,
      expiresAt,
      ipAddress: ipAddress ?? null,
      userAgent: userAgent ?? null,
    },
  });

  return token;
}

export async function rotateRefreshToken(
  oldToken: string,
  clientId: string,
): Promise<TokenSet | null> {
  const tokenHash = hashToken(oldToken);
  const existing = await db.oAuthRefreshToken.findFirst({
    where: { tokenHash, clientId },
  });

  if (!existing) return null;

  // Check for reuse (already rotated/revoked)
  if (existing.rotatedAt || existing.revokedAt) {
    // REUSE DETECTED — revoke entire family
    await db.oAuthRefreshToken.updateMany({
      where: { familyId: existing.familyId },
      data: { revokedAt: new Date() },
    });
    await db.oAuthRefreshToken.update({
      where: { id: existing.id },
      data: { reuseDetectedAt: new Date() },
    });
    return null;
  }

  // Check expiry
  if (existing.expiresAt < new Date()) return null;

  // Rotate: mark old as rotated, issue new
  await db.oAuthRefreshToken.update({
    where: { id: existing.id },
    data: { rotatedAt: new Date() },
  });

  const user = await db.user.findUnique({ where: { id: existing.userId } });
  if (!user || user.status !== "ACTIVE") return null;

  const scopeStr = existing.scope;

  const access_token = await issueAccessToken({
    sub: user.id,
    email: user.email,
    email_verified: !!user.emailVerifiedAt,
    scope: scopeStr,
    client_id: clientId,
  });

  const refresh_token = await createRefreshToken(
    user.id,
    clientId,
    existing.familyId,
    existing.id,
    scopeStr,
  );

  const id_token = await issueIdToken(
    {
      sub: user.id,
      email: user.email,
      email_verified: !!user.emailVerifiedAt,
      name: user.displayName ?? undefined,
      given_name: user.givenName ?? undefined,
      family_name: user.familyName ?? undefined,
      picture: user.avatarUrl ?? undefined,
    },
    clientId,
  );

  return {
    access_token,
    token_type: "Bearer",
    expires_in: config.accessTokenTtl,
    refresh_token,
    id_token,
    scope: scopeStr,
  };
}

export async function revokeRefreshTokenFamily(
  token: string,
): Promise<boolean> {
  const tokenHash = hashToken(token);
  const existing = await db.oAuthRefreshToken.findFirst({
    where: { tokenHash },
  });
  if (!existing) return false;

  await db.oAuthRefreshToken.updateMany({
    where: { familyId: existing.familyId },
    data: { revokedAt: new Date() },
  });

  return true;
}
