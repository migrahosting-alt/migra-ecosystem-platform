/**
 * OAuth Clients module — client registration and validation.
 */
import { db } from "../../lib/db.js";
import type { OAuthClient } from ".prisma/auth-client";

export type { OAuthClient };

export async function findClientById(
  clientId: string,
): Promise<OAuthClient | null> {
  return db.oAuthClient.findUnique({ where: { clientId } });
}

export function validateRedirectUri(
  client: OAuthClient,
  redirectUri: string,
): boolean {
  const uris = client.redirectUris as string[];
  return uris.includes(redirectUri);
}

export function validatePostLogoutUri(
  client: OAuthClient,
  uri: string,
): boolean {
  const uris = client.postLogoutRedirectUris as string[];
  return uris.includes(uri);
}

export function validateScopes(
  client: OAuthClient,
  requestedScopes: string[],
): string[] {
  const allowed = new Set(client.allowedScopes as string[]);
  return requestedScopes.filter((s) => allowed.has(s));
}
