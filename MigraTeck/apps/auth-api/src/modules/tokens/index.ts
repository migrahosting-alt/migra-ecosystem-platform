/**
 * Tokens module — auth code issuance/exchange, refresh token rotation.
 * Models: OAuthAuthorizationCode, OAuthRefreshToken (scope as text).
 */
import { db } from "../../lib/db.js";
import { generateToken, hashToken, verifyCodeChallenge } from "../../lib/crypto.js";
import { issueAccessToken, issueIdToken } from "../../lib/jwt.js";
import { config } from "../../config/env.js";
import { activeOrganizationClaims, revalidateActiveOrganization } from "../organizations/activeOrganization.js";
import { loadMemberships } from "../organizations/memberships.js";
import { randomUUID } from "node:crypto";
import type { User } from "../../prisma-client.js";

// ── Auth Code ───────────────────────────────────────────────────────

export async function createAuthCode(
  userId: string,
  clientId: string,
  redirectUri: string,
  codeChallenge: string,
  codeChallengeMethod: string,
  scopes: string[],
  nonce?: string,
  opts?: {
    stateHash?: string;
    nonceHash?: string;
    issuedIp?: string;
    issuedUserAgent?: string;
    /**
     * The organization selected AND membership-verified during authorization.
     *
     * Recorded on the code so the token endpoint reads it rather than accepting one from
     * the token request. Absent for clients that are not organization-bound.
     */
    organizationId?: string;
  },
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
      organizationId: opts?.organizationId ?? null,
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

  /**
   * The organization comes from the CODE, never from this request.
   *
   * `exchangeAuthCode` receives nothing about organizations from the caller and there is
   * deliberately no parameter for it: the binding was made where the user consented to it,
   * and a token endpoint that accepted a replacement would make that consent decorative.
   *
   * It is re-checked rather than trusted. Membership can be suspended between authorize
   * and exchange, and a code minted a minute ago must not outlive the access it recorded.
   */
  const client = await db.oAuthClient.findUnique({ where: { clientId } });
  const requiresOrg = client?.requiresActiveOrganization ?? false;
  const orgDecision = revalidateActiveOrganization({
    boundOrganizationId: authCode.organizationId ?? undefined,
    memberships: await loadMemberships(user.id),
    clientRequiresActiveOrganization: requiresOrg,
  });
  // Fails closed. The code is already marked used above, so a refused exchange cannot be
  // retried against the same code either.
  if (!orgDecision.ok) return null;
  const orgClaims = orgDecision.active ? activeOrganizationClaims(orgDecision.active) : {};

  // Issue tokens
  const access_token = await issueAccessToken({
    sub: user.id,
    email: user.email ?? undefined,
    email_verified: !!user.emailVerifiedAt,
    scope: scopeStr,
    client_id: clientId,
    ...orgClaims,
  });

  const refresh_token = await createRefreshToken(
    user.id, clientId, undefined, undefined, scopeStr, undefined, undefined, undefined,
    orgDecision.active?.orgId ?? null,
  );

  let id_token: string | undefined;
  if (scopes.includes("openid")) {
    id_token = await issueIdToken(
      {
        sub: user.id,
        email: user.email ?? undefined,
        email_verified: !!user.emailVerifiedAt,
        name: user.displayName ?? undefined,
        given_name: user.givenName ?? undefined,
        family_name: user.familyName ?? undefined,
        picture: user.avatarUrl ?? undefined,
        // Mirrors the access token. The two must never disagree about the active tenant.
        ...orgClaims,
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
  deviceId?: string,
  organizationId?: string | null,
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
      deviceId: deviceId ?? null,
      organizationId: organizationId ?? null,
    },
  });

  return token;
}

export async function findRefreshToken(
  token: string,
  clientId: string,
) {
  const tokenHash = hashToken(token);
  return db.oAuthRefreshToken.findFirst({
    where: { tokenHash, clientId },
  });
}

export async function issueFirstPartyRefreshToken(input: {
  userId: string;
  sessionId: string;
  clientId?: string;
  ipAddress?: string;
  userAgent?: string;
  scope?: string;
}): Promise<string> {
  return createRefreshToken(
    input.userId,
    input.clientId ?? config.firstPartyRefreshClientId,
    undefined,
    undefined,
    input.scope ?? "openid profile email offline_access",
    input.ipAddress,
    input.userAgent,
    input.sessionId,
  );
}

export async function rotateRefreshToken(
  oldToken: string,
  clientId: string,
  options?: {
    ipAddress?: string;
    userAgent?: string;
    deviceId?: string;
  },
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

  /**
   * Refresh can only PRESERVE the organization or refuse it.
   *
   * There is no parameter here that could change it — the bound value is read from the
   * stored token and re-checked against current membership. That is what makes "switch
   * organizations by sending a header" structurally impossible rather than merely
   * disallowed, and it is why a revoked membership stops working at the next refresh
   * instead of lasting the token's lifetime.
   */
  const refreshClient = await db.oAuthClient.findUnique({ where: { clientId } });
  const orgDecision = revalidateActiveOrganization({
    boundOrganizationId: existing.organizationId ?? undefined,
    memberships: await loadMemberships(user.id),
    clientRequiresActiveOrganization: refreshClient?.requiresActiveOrganization ?? false,
  });
  if (!orgDecision.ok) return null;
  const orgClaims = orgDecision.active ? activeOrganizationClaims(orgDecision.active) : {};

  const access_token = await issueAccessToken({
    sub: user.id,
    email: user.email ?? undefined,
    email_verified: !!user.emailVerifiedAt,
    scope: scopeStr,
    client_id: clientId,
    ...orgClaims,
  });

  const refresh_token = await createRefreshToken(
    user.id,
    clientId,
    existing.familyId,
    existing.id,
    scopeStr,
    options?.ipAddress ?? existing.ipAddress ?? undefined,
    options?.userAgent ?? existing.userAgent ?? undefined,
    options?.deviceId ?? existing.deviceId ?? undefined,
    // The rotated token inherits the SAME organization, so the binding survives every
    // rotation in the family rather than being lost at the first one.
    orgDecision.active?.orgId ?? existing.organizationId ?? null,
  );

  const id_token = await issueIdToken(
    {
      sub: user.id,
      email: user.email ?? undefined,
      email_verified: !!user.emailVerifiedAt,
      name: user.displayName ?? undefined,
      given_name: user.givenName ?? undefined,
      family_name: user.familyName ?? undefined,
      picture: user.avatarUrl ?? undefined,
      ...orgClaims,
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

export async function rotateFirstPartyRefreshToken(
  oldToken: string,
  input?: {
    sessionId?: string;
    ipAddress?: string;
    userAgent?: string;
    clientId?: string;
  },
): Promise<TokenSet | null> {
  return rotateRefreshToken(
    oldToken,
    input?.clientId ?? config.firstPartyRefreshClientId,
    {
      deviceId: input?.sessionId,
      ipAddress: input?.ipAddress,
      userAgent: input?.userAgent,
    },
  );
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
