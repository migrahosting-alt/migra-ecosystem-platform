import { randomUUID } from "node:crypto";
import { clearPkceCookies, exchangeCode, fetchUserInfo, getPkceCookies } from "./oauth";
import { getAuthClientConfig } from "./config";
import { setAppSession } from "./session";
import type { BootstrapFn } from "./types";

/**
 * How long the APPLICATION session lasts.
 *
 * By default it matches the OAuth access token, which is the conservative
 * choice but is wrong for any app that stops using the token after bootstrap.
 * MigraAuth issues 15-minute access tokens (`AUTH_ACCESS_TOKEN_TTL`, default
 * 900s), so a consumer that never touches the token again was signing users out
 * every fifteen minutes — mid-conversation — with no refresh path.
 *
 * `sessionTtlSeconds` lets such an app state its own lifetime. It is opt-in
 * precisely so this default does not change under apps that DO use the access
 * token and must expire with it.
 *
 * TRADE-OFF, deliberately accepted by the caller that sets it: a longer app
 * session no longer tracks the issuer's. A sign-out or revocation at MigraAuth
 * will not propagate here until the app session itself expires. Closing that
 * gap needs refresh-token rotation or token introspection, neither of which
 * exists yet — and storing a refresh token in this cookie is NOT the answer,
 * because the session payload is signed but not encrypted.
 */
function appSessionLifetimeMs(tokenExpiresInSeconds: number): number {
  const configured = getAuthClientConfig().sessionTtlSeconds;
  const seconds =
    typeof configured === "number" && Number.isFinite(configured) && configured > 0
      ? configured
      : tokenExpiresInSeconds;
  return seconds * 1000;
}

export async function handleOAuthCallback(params: {
  code: string;
  state: string;
  bootstrap: BootstrapFn;
}) {
  const { state: savedState, verifier } = await getPkceCookies(params.state);

  if (!savedState || savedState !== params.state || !verifier) {
    throw new Error("Invalid OAuth state");
  }

  const tokens = await exchangeCode(params.code, verifier);
  const userInfo = await fetchUserInfo(tokens.access_token);

  const bootstrapResult = await params.bootstrap({
    authUserId: userInfo.sub,
    email: userInfo.email,
    emailVerified: userInfo.email_verified === true,
    ...(userInfo.name ? { displayName: userInfo.name } : {}),
    accessToken: tokens.access_token,
    ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
    expiresInSeconds: tokens.expires_in,
  });

  await setAppSession({
    sessionId: randomUUID(),
    authUserId: userInfo.sub,
    email: userInfo.email,
    ...(userInfo.name ? { displayName: userInfo.name } : {}),
    ...(bootstrapResult.activeOrg?.id ? { activeOrgId: bootstrapResult.activeOrg.id } : {}),
    ...(bootstrapResult.activeOrg?.name ? { activeOrgName: bootstrapResult.activeOrg.name } : {}),
    ...(bootstrapResult.activeOrg?.role ? { activeOrgRole: bootstrapResult.activeOrg.role } : {}),
    permissions: bootstrapResult.permissions,
    ...(bootstrapResult.productAccount !== undefined
      ? { productAccount: bootstrapResult.productAccount }
      : {}),
    createdAt: Date.now(),
    expiresAt: Date.now() + appSessionLifetimeMs(tokens.expires_in),
  });

  await clearPkceCookies(params.state);

  return {
    user: {
      id: userInfo.sub,
      email: userInfo.email,
      displayName: userInfo.name,
    },
    ...bootstrapResult,
  };
}
