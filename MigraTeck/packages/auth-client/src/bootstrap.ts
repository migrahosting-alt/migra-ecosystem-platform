import { randomUUID } from "node:crypto";
import { clearPkceCookies, exchangeCode, fetchUserInfo, getPkceCookies } from "./oauth";
import { setAppSession } from "./session";
import type { BootstrapFn } from "./types";

export async function handleOAuthCallback(params: {
  code: string;
  state: string;
  bootstrap: BootstrapFn;
}) {
  const { state: savedState, verifier } = await getPkceCookies();

  if (!savedState || savedState !== params.state || !verifier) {
    throw new Error("Invalid OAuth state");
  }

  const tokens = await exchangeCode(params.code, verifier);
  const userInfo = await fetchUserInfo(tokens.access_token);

  const bootstrapResult = await params.bootstrap({
    authUserId: userInfo.sub,
    email: userInfo.email,
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
    expiresAt: Date.now() + tokens.expires_in * 1000,
  });

  await clearPkceCookies();

  return {
    user: {
      id: userInfo.sub,
      email: userInfo.email,
      displayName: userInfo.name,
    },
    ...bootstrapResult,
  };
}
